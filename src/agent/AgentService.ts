import { ToolRouter } from "@/agent/ToolRouter";
import type { RecentMessage } from "@/agent/llm/contextBuilder";
import { ActionPlanner } from "@/agent/experience/ActionPlanner";
import type { PlannerPort } from "@/agent/experience/PlannerPort";
import type { MemoryAdapter } from "@/agent/memory/MemoryAdapter";
import type { RagAdapter } from "@/agent/memory/RagAdapter";
import type { NotificationAdapter } from "@/agent/notification/NotificationAdapter";
import {
  ConversationContextBuilder,
  type ConversationMemorySnapshot,
} from "@/agent/experience/ConversationContextBuilder";
import { formatDateKey } from "@/agent/experience/dateFormatting";
import { ResponseBoundary } from "@/agent/experience/ResponseBoundary";
import type { ResponseKind } from "@/agent/experience/ResponseComposer";
import { SemanticFrameParser } from "@/agent/experience/SemanticFrameParser";
import { AgentDomainRouter } from "@/agent/router/AgentDomainRouter";
import { TimeManagementAgent } from "@/agent/time-management/TimeManagementAgent";
import type { AgentHandler } from "@/agent/handlers/AgentHandler";
import { ExternalInfoHandler } from "@/agent/handlers/ExternalInfoHandler";
import { MetaHandler } from "@/agent/handlers/MetaHandler";
import { FeedbackHandler } from "@/agent/handlers/FeedbackHandler";
import { LowSignalHandler } from "@/agent/handlers/LowSignalHandler";
import { LLMDirectHandler } from "@/agent/handlers/LLMDirectHandler";
import type {
  AgentDomain,
  AgentHandlerResult,
  AgentRefreshHints,
  AgentToolResult,
  AgentTrace,
  ChatMessageMetadata,
  ExperienceActionPlan,
  IntentType,
  ParsedIntent,
  PlanOption,
  PlanProposal,
  SemanticFrame,
} from "@/agent/types";
import type { FreeSlot } from "@/agent/tools/schedule/getFreeSlotsTool";
import { formatTime } from "@/lib/dateUtils";
import type { TimeBlock } from "@/types/timeblock.types";
import { ActionLogService } from "@/services/ActionLogService";
import { ConfirmationService } from "@/services/ConfirmationService";
import { ScheduleService } from "@/services/ScheduleService";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";

import { CreateTaskTool } from "@/agent/tools/task/createTaskTool";
import { UpdateTaskTool } from "@/agent/tools/task/updateTaskTool";
import { DeleteTaskTool } from "@/agent/tools/task/deleteTaskTool";
import { ListTasksTool } from "@/agent/tools/task/listTasksTool";
import { MarkTaskCompletedTool } from "@/agent/tools/task/markTaskCompletedTool";
import { CreateTimeBlockTool } from "@/agent/tools/timeblock/createTimeBlockTool";
import { UpdateTimeBlockTool } from "@/agent/tools/timeblock/updateTimeBlockTool";
import { DeleteTimeBlockTool } from "@/agent/tools/timeblock/deleteTimeBlockTool";
import { ListTimeBlocksTool } from "@/agent/tools/timeblock/listTimeBlocksTool";
import { BindTaskToTimeBlockTool } from "@/agent/tools/timeblock/bindTaskToTimeBlockTool";
import { ScheduleTaskTool } from "@/agent/tools/schedule/scheduleTaskTool";
import { RescheduleDayTool } from "@/agent/tools/schedule/rescheduleDayTool";
import { DetectConflictsTool } from "@/agent/tools/schedule/detectConflictsTool";
import { GetFreeSlotsTool } from "@/agent/tools/schedule/getFreeSlotsTool";
import { GetTodayPlanTool } from "@/agent/tools/schedule/getTodayPlanTool";
import { ExplainTaskTool } from "@/agent/tools/explain/explainTaskTool";
import { ExplainScheduleTool } from "@/agent/tools/explain/explainScheduleTool";

// ─── AgentResponse ─────────────────────────────────────────────────────────

export interface AgentResponse {
  message: string;
  intent: ParsedIntent;
  toolResult?: AgentToolResult;
  confirmationId?: string;
  refreshHints?: AgentRefreshHints;
  /** V2.5：action_log 记录 ID，供 chatStore 写入 metadata */
  actionLogId?: string;
  /** V2.5：完整 metadata，供 chatStore 写入 conversation_messages.metadata_json */
  metadata?: ChatMessageMetadata;
}

interface PlanConflictInfo {
  toolName: string;
  start_time: string;
  end_time: string;
  excludeId?: string;
  message: string;
  conflictingBlocks?: Array<{
    id: string;
    title: string;
    start_time: string;
    end_time: string;
  }>;
}

interface ExecutePlanOptionResult {
  success: boolean;
  message: string;
  actionLogIds?: string[];
  metadata?: ChatMessageMetadata;
  conflictInfo?: PlanConflictInfo;
}

interface PlanPrecheckResult {
  ok: boolean;
  message?: string;
  conflictInfo?: PlanConflictInfo;
}

interface SinglePlanAction {
  toolName: string;
  params: Record<string, unknown>;
  summary?: string;
}

// ─── ProcessInput 调用上下文（V3 新增） ─────────────────────────────────────

export interface ProcessInputContext {
  /** chatStore 传入的最近消息，用于 LLM 指代消解 */
  recentMessages?: RecentMessage[];
  timezone?: string;
  currentTimelineDate?: string;
  selectedDate?: string;
  currentScreen?: string;
}

interface ActionLogPort {
  logRequest(userInput: string, detectedIntent?: string): Promise<{ id: string }>;
  logToolExecution(
    logId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<unknown>;
  logSuccess(logId: string, result: unknown): Promise<unknown>;
  logFailure(logId: string, errorMessage: string): Promise<unknown>;
  logCancelled(logId: string): Promise<unknown>;
}

interface AgentServiceOptions {
  taskService?: TaskService;
  timeBlockService?: TimeBlockService;
  scheduleService?: ScheduleService;
  logService?: ActionLogPort;
  confirmService?: ConfirmationService;
  /** Phase 1+: 可替换的 Planner 实现（默认 ActionPlanner）。测试时可注入 StubPlanner。 */
  plannerPort?: PlannerPort;
  /** Phase 1+: 行为记录适配器（默认不启用）。 */
  memoryAdapter?: MemoryAdapter;
  /** Phase 1+: RAG 检索适配器（默认不启用）。 */
  ragAdapter?: RagAdapter;
  /** Phase 1+: 通知适配器（默认不启用）。 */
  notificationAdapter?: NotificationAdapter;
}

// ─── AgentService ───────────────────────────────────────────────────────────

export class AgentService {
  private router: ToolRouter;
  private logService: ActionLogPort;
  private confirmService: ConfirmationService;
  private taskService: TaskService;
  private timeBlockService: TimeBlockService;
  private scheduleService: ScheduleService;

  // V3：LLM 相关组件
  private experienceContextBuilder: ConversationContextBuilder;
  private semanticFrameParser: SemanticFrameParser;
  private plannerPort: PlannerPort;
  private responseBoundary: ResponseBoundary;
  private domainRouter: AgentDomainRouter;
  private timeManagementAgent: TimeManagementAgent;
  private handlers: Map<AgentDomain, AgentHandler>;

  // Phase 1+: 可选适配器（mock 或未来真实实现）
  readonly memoryAdapter: MemoryAdapter | undefined;
  readonly ragAdapter: RagAdapter | undefined;
  readonly notificationAdapter: NotificationAdapter | undefined;

  private lastCreatedTaskId: string | null = null;
  private lastMentionedTaskIds: string[] = [];
  private lastScheduledTimeBlockIds: string[] = [];
  private lastToolResults: AgentToolResult[] = [];

  constructor(options: AgentServiceOptions = {}) {
    this.router = new ToolRouter();
    this.logService = options.logService ?? new ActionLogService();
    this.confirmService = options.confirmService ?? new ConfirmationService();
    this.taskService = options.taskService ?? new TaskService();
    this.timeBlockService = options.timeBlockService ?? new TimeBlockService();
    this.scheduleService = options.scheduleService ?? new ScheduleService();

    this.experienceContextBuilder = new ConversationContextBuilder();
    this.semanticFrameParser = new SemanticFrameParser();
    this.plannerPort = options.plannerPort ?? new ActionPlanner(this.taskService);
    this.responseBoundary = new ResponseBoundary();
    this.domainRouter = new AgentDomainRouter();
    this.memoryAdapter = options.memoryAdapter;
    this.ragAdapter = options.ragAdapter;
    this.notificationAdapter = options.notificationAdapter;
    this.timeManagementAgent = new TimeManagementAgent({
      taskService: this.taskService,
      timeBlockService: this.timeBlockService,
      router: this.router,
      logService: this.logService,
      plannerPort: this.plannerPort,
      semanticFrameParser: this.semanticFrameParser,
      experienceContextBuilder: this.experienceContextBuilder,
      responseBoundary: this.responseBoundary,
      confirmationService: this.confirmService,
    });
    this.handlers = new Map<AgentDomain, AgentHandler>([
      ["general_chat", new LLMDirectHandler("general_chat")],
      ["knowledge_qa", new LLMDirectHandler("knowledge_qa")],
      ["writing_assistant", new LLMDirectHandler("writing_assistant")],
      ["external_info", new ExternalInfoHandler()],
      ["assistant_meta", new MetaHandler()],
      ["feedback_or_complaint", new FeedbackHandler()],
      ["low_signal", new LowSignalHandler()],
    ]);

    this.registerTools();
  }

  private registerTools(): void {
    this.router.register(new CreateTaskTool(this.taskService));
    this.router.register(new UpdateTaskTool(this.taskService));
    this.router.register(new DeleteTaskTool(this.taskService));
    this.router.register(new ListTasksTool(this.taskService));
    this.router.register(new MarkTaskCompletedTool(this.taskService));
    this.router.register(new CreateTimeBlockTool(this.timeBlockService));
    this.router.register(new UpdateTimeBlockTool(this.timeBlockService));
    this.router.register(new DeleteTimeBlockTool(this.timeBlockService));
    this.router.register(new ListTimeBlocksTool(this.timeBlockService));
    this.router.register(new BindTaskToTimeBlockTool(this.scheduleService));
    this.router.register(
      new ScheduleTaskTool(this.taskService, this.timeBlockService, this.scheduleService)
    );
    this.router.register(new RescheduleDayTool(this.timeBlockService, this.taskService));
    this.router.register(new DetectConflictsTool(this.scheduleService));
    this.router.register(new GetFreeSlotsTool(this.timeBlockService));
    this.router.register(new GetTodayPlanTool(this.timeBlockService, this.taskService));
    this.router.register(new ExplainTaskTool(this.taskService, this.timeBlockService));
    this.router.register(new ExplainScheduleTool(this.timeBlockService));
  }

  // ─── 主入口：处理用户输入（V3.5 LLM-first，无 fallback） ───────────────────

  async processInput(
    userInput: string,
    context?: ProcessInputContext
  ): Promise<AgentResponse> {
    const experienceContext = this.timeManagementAgent.buildContext(
      context,
      this.getConversationMemorySnapshot()
    );
    const route = this.domainRouter.classify(userInput);

    if (route.domain === "time_management") {
      const semanticFrame = this.timeManagementAgent.parse(userInput);
      const handled = await this.timeManagementAgent.handle({
        userInput,
        context: experienceContext,
        semanticFrame,
      });

      const trace = handled.metadata.agentTrace;
      if (trace?.semanticFrame && trace?.actionPlan) {
        for (const toolResult of trace.toolResults ?? []) {
          if (!toolResult.success) continue;
          this.trackLastEntities(trace.actionPlan.toolName ?? "", toolResult);
          this.updateExperienceMemory(trace.semanticFrame, trace.actionPlan, toolResult);
        }
        if (
          trace.actionPlan.kind === "query_schedule" &&
          typeof trace.actionPlan.params.taskId === "string"
        ) {
          this.rememberMentionedTask(trace.actionPlan.params.taskId);
        }
      }

      return {
        message: handled.response.message ?? "",
        intent: handled.intent,
        toolResult: handled.response.toolResults?.[0],
        refreshHints: handled.response.refreshHints,
        actionLogId: handled.metadata.actionLogId,
        confirmationId: handled.response.confirmationId,
        metadata: handled.metadata,
      };
    }

    const handler = this.handlers.get(route.domain);
    const handlerResult: AgentHandlerResult = handler
      ? await handler.handle(userInput, experienceContext)
      : { domain: "general_chat", responseKind: "general" };

    const frame = this.buildRouterFrame(route.domain, userInput);
    const plan = this.buildRouterPlan(frame.userGoal, experienceContext.currentDatetime);
    const message = this.responseBoundary.finalize({
      context: experienceContext,
      frame,
      plan,
      result: handlerResult,
    });

    const log = await this.logService.logRequest(userInput, route.domain);
    await this.logService.logSuccess(log.id, { domain: route.domain });

    const trace: AgentTrace = {
      planner: "router",
      domain: route.domain,
      mode: "direct_response",
      rawInput: userInput,
      contextSnapshot: experienceContext,
      semanticFrame: frame,
      actionPlan: plan,
      toolResults: [],
      finalResponse: message,
    };

    return {
      message,
      intent: {
        intent: "unknown",
        confidence: route.confidence,
        args: { domain: route.domain },
        rawInput: userInput,
      },
      actionLogId: log.id,
      metadata: {
        intent: route.domain,
        actionLogId: log.id,
        resultType: "success",
        source: "llm",
        confidence: route.confidence,
        agentTrace: trace,
      },
    };
  }

  private buildRouterFrame(domain: AgentDomain, userInput: string): SemanticFrame {
    return {
      userGoal: "general_chat",
      objectReferences: [],
      timeExpressions: [],
      durationExpressions: [],
      constraints: { domain },
      userTone: "neutral",
      urgency: "normal",
      missingInfo: [],
      confidence: 0.8,
      extractedTitle: userInput.slice(0, 32),
    };
  }

  private buildRouterPlan(
    userGoal: SemanticFrame["userGoal"],
    currentDatetime: string
  ): ExperienceActionPlan {
    return {
      id: crypto.randomUUID(),
      kind: "direct_response",
      userGoal,
      params: { currentDatetime },
      requiresConfirmation: false,
      riskLevel: "safe",
      summary: "router_direct",
      createdAt: new Date().toISOString(),
    };
  }

  // ─── Router 路径下边界消息辅助 ─────────────────────────────────────────────

  private composeBoundaryMessage(
    userInput: string,
    context: ProcessInputContext | undefined,
    responseKind: ResponseKind,
    toolResults: AgentToolResult[] = []
  ): string {
    const experienceContext = this.experienceContextBuilder.build(
      context,
      this.getConversationMemorySnapshot()
    );
    const semanticFrame = this.semanticFrameParser.parse(userInput);
    const plan: ExperienceActionPlan = {
      id: crypto.randomUUID(),
      kind: "direct_response",
      userGoal: semanticFrame.userGoal,
      params: { currentDatetime: experienceContext.currentDatetime },
      requiresConfirmation: false,
      riskLevel: "safe",
      summary: responseKind,
      createdAt: new Date().toISOString(),
    };

    return this.responseBoundary.finalize({
      context: experienceContext,
      frame: semanticFrame,
      plan,
      result: {
        domain: "general_chat",
        responseKind,
        toolResults,
      },
    });
  }

  // ─── 旧链路已迁移到 Router/Handler ────────────────────────────────────────

  // ─── 确认执行 ────────────────────────────────────────────────────────────

  async confirmAction(confirmationId: string): Promise<AgentResponse> {
    const confirmation = await this.confirmService.getById(confirmationId);
    if (!confirmation) {
      return {
        message: this.composeBoundaryMessage("", undefined, "confirmation_missing"),
        intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
      };
    }

    if (confirmation.status !== "pending") {
      return {
        message: this.composeBoundaryMessage("", undefined, "confirmation_stale"),
        intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
      };
    }

    await this.confirmService.confirm(confirmationId);

    const args = JSON.parse(confirmation.tool_args_json) as Record<string, unknown>;

    // 记录确认执行日志
    const log = await this.logService.logRequest(
      `[确认执行] ${confirmation.action_type}`,
      confirmation.action_type
    );
    await this.logService.logToolExecution(log.id, confirmation.tool_name, args);

    const result = await this.router.execute(confirmation.tool_name, args);

    if (result.success) {
      await this.logService.logSuccess(log.id, result.data);
      this.trackLastEntities(confirmation.tool_name, result);
    } else {
      await this.logService.logFailure(log.id, result.error ?? result.message);
    }

    const metadata: ChatMessageMetadata = {
      intent: confirmation.action_type,
      toolName: confirmation.tool_name,
      actionLogId: log.id,
      confirmationId,
      relatedTaskId: result.relatedTaskId,
      relatedTimeBlockId: result.relatedTimeBlockId,
      resultType: result.success ? "success" : "failure",
      source: "chat",
    };
    const refreshHints = this.buildConfirmationRefreshHints(
      confirmation.tool_name,
      args,
      result
    );

    return {
      message: this.composeBoundaryMessage(
        "",
        undefined,
        result.success ? "tool_success" : "tool_failure",
        [result]
      ),
      intent: {
        intent: confirmation.action_type as IntentType,
        confidence: 1,
        args,
        rawInput: "",
      },
      toolResult: result,
      actionLogId: log.id,
      metadata,
      refreshHints,
    };
  }

  // ─── 拒绝执行（Phase 4：新建 cancelled action_log） ──────────────────────

  async rejectAction(confirmationId: string): Promise<AgentResponse> {
    // 先获取 confirmation 以取得 tool_name / tool_args 用于日志记录
    const confirmation = await this.confirmService.getById(confirmationId);

    // 无论 confirmation 是否存在，尝试更新状态
    try {
      await this.confirmService.reject(confirmationId);
    } catch {
      // confirmation 不存在或已非 pending，忽略
    }

    // 新建一条 cancelled action_log（不反查旧 log）
    const toolName = confirmation?.tool_name ?? "unknown";
    const toolArgs = confirmation?.tool_args_json
      ? (JSON.parse(confirmation.tool_args_json) as Record<string, unknown>)
      : {};

    const log = await this.logService.logRequest(
      `[拒绝确认] ${confirmation?.action_type ?? confirmationId}`,
      confirmation?.action_type
    );
    await this.logService.logToolExecution(log.id, toolName, {
      ...toolArgs,
      _confirmationId: confirmationId,
    });
    await this.logService.logCancelled(log.id);

    const metadata: ChatMessageMetadata = {
      intent: confirmation?.action_type,
      toolName,
      actionLogId: log.id,
      confirmationId,
      resultType: "rejected",
      source: "chat",
    };

    return {
      message: this.composeBoundaryMessage("", undefined, "confirmation_rejected"),
      intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
      actionLogId: log.id,
      metadata,
    };
  }

  // ─── 私有辅助方法 ────────────────────────────────────────────────────────

  private getConversationMemorySnapshot(): ConversationMemorySnapshot {
    return {
      lastCreatedTaskId: this.lastCreatedTaskId,
      lastMentionedTaskIds: [...this.lastMentionedTaskIds],
      lastScheduledTimeBlockIds: [...this.lastScheduledTimeBlockIds],
      lastToolResults: [...this.lastToolResults],
    };
  }

  private updateExperienceMemory(
    frame: SemanticFrame,
    plan: ExperienceActionPlan,
    result: AgentToolResult
  ): void {
    if (result.relatedTaskId) {
      this.rememberMentionedTask(result.relatedTaskId);
      if (frame.userGoal === "create_and_schedule_task") {
        this.lastCreatedTaskId = result.relatedTaskId;
      }
    }

    if (result.relatedTimeBlockId) {
      this.lastScheduledTimeBlockIds = this.prependUnique(
        this.lastScheduledTimeBlockIds,
        result.relatedTimeBlockId
      );
    }

    this.lastToolResults = [result, ...this.lastToolResults].slice(0, 5);

    // V5+: 记录行为到 MemoryAdapter（在 ToolRouter execute 成功后，不在 Tool 内部）
    if (this.memoryAdapter && result.success) {
      if (
        frame.userGoal === "create_and_schedule_task" &&
        plan.toolName === "schedule_task"
      ) {
        void this.memoryAdapter.recordSchedule({
          taskId: result.relatedTaskId ?? "",
          title: String(plan.params.title ?? ""),
          category: frame.category,
          estimatedMinutes: Number(plan.params.duration ?? 0),
        });
      }
    }

    // V5+: 提醒创建后发送通知（只有 create_time_block/create_reminder 触发）
    if (
      this.notificationAdapter &&
      result.success &&
      plan.toolName === "create_time_block" &&
      frame.userGoal === "create_reminder"
    ) {
      void this.notificationAdapter.notify({
        channel: "reminder",
        title: String(plan.params.title ?? "提醒"),
        message: `提醒已创建：${String(plan.params.title ?? "")}`,
        scheduledAt: String(plan.params.start_time ?? ""),
      });
    }
  }

  private rememberMentionedTask(taskId: string): void {
    this.lastMentionedTaskIds = this.prependUnique(
      this.lastMentionedTaskIds,
      taskId
    );
  }

  private prependUnique(values: string[], value: string): string[] {
    return [value, ...values.filter((item) => item !== value)].slice(0, 5);
  }

  private trackLastEntities(_toolName: string, result: AgentToolResult): void {
    // 兼容旧路径：从 data 对象中提取
    if (!result.relatedTaskId && result.data) {
      const data = result.data as Record<string, unknown>;
      if (data.id && typeof data.id === "string") return;
      if (data.task && typeof data.task === "object") {
        const task = data.task as Record<string, unknown>;
        if (task.id && typeof task.id === "string") return;
      }
    }
  }

  private buildConfirmationRefreshHints(
    toolName: string,
    args: Record<string, unknown>,
    result: AgentToolResult
  ): AgentRefreshHints | undefined {
    if (!result.success) return undefined;

    const startTime =
      typeof args.start_time === "string" ? args.start_time : undefined;
    const timelineDate = startTime
      ? formatDateKey(new Date(startTime))
      : undefined;

    if (toolName === "schedule_task") {
      return { tasks: true, timeline: true, timelineDate };
    }

    if (toolName === "create_time_block") {
      return { timeline: true, timelineDate };
    }

    if (toolName === "delete_task") {
      return { tasks: true, timeline: true };
    }

    if (toolName === "delete_time_block" || toolName === "update_time_block") {
      return { timeline: true, timelineDate };
    }

    if (toolName === "create_task" || toolName === "update_task") {
      return { tasks: true };
    }

    return undefined;
  }

  // ─── V3.5-B：Delay / Feedback 重排方案提议 ────────────────────────────────

  /**
   * 为已延迟的 TimeBlock 查找今日空闲时段，构造重排方案。
   * 用于 DelayChoiceDialog「今天做」路径。
   */
  async proposeReschedule(block: TimeBlock): Promise<PlanProposal> {
    const today = new Date().toISOString().split("T")[0];
    const durationMs =
      new Date(block.end_time).getTime() - new Date(block.start_time).getTime();

    const slotsResult = await this.router.execute("get_free_slots", {
      date: today,
      minDurationMinutes: 30,
    });

    const rawSlots = (slotsResult.data as FreeSlot[] | undefined) ?? [];
    if (rawSlots.length === 0) {
      return {
        mode: "propose",
        options: [],
        question: "今天暂无空闲时段，建议选择「之后做」。",
      };
    }

    const options: PlanOption[] = rawSlots.slice(0, 5).map((slot) => {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(
        Math.min(slotStart.getTime() + durationMs, new Date(slot.end).getTime())
      );
      return {
        label: `${formatTime(slotStart)} – ${formatTime(slotEnd)}（${Math.round(
          (slotEnd.getTime() - slotStart.getTime()) / 60000
        )} 分钟）`,
        toolName: "update_time_block",
        params: {
          timeBlockId: block.id,
          start_time: slotStart.toISOString(),
          end_time: slotEnd.toISOString(),
        },
        summary: `将「${block.title}」重新安排到 ${formatTime(slotStart)}`,
      };
    });

    return { mode: "propose", options, question: "选择今天的新时段：" };
  }

  /**
   * 为结束反馈构造操作方案。
   * - mode="extend"：提议延长当前时间块（30 / 60 / 90 分钟）
   * - mode="split"：提议创建剩余任务
   */
  async proposeEndFeedback(
    block: TimeBlock,
    mode: "extend" | "split"
  ): Promise<PlanProposal> {
    if (mode === "extend") {
      const options: PlanOption[] = [30, 60, 90].map((ext) => {
        const newEnd = new Date(
          new Date(block.end_time).getTime() + ext * 60000
        );
        return {
          label: `延长 ${ext} 分钟（到 ${formatTime(newEnd)}）`,
          toolName: "update_time_block",
          params: { timeBlockId: block.id, end_time: newEnd.toISOString() },
          summary: `将「${block.title}」延长 ${ext} 分钟至 ${formatTime(newEnd)}`,
        };
      });
      return { mode: "propose", options, question: "选择延长时间：" };
    }

    // split: 创建剩余任务
    return {
      mode: "propose",
      options: [
        {
          label: `创建「${block.title}（剩余）」任务`,
          toolName: "create_task",
          params: { title: `${block.title}（剩余）`, priority: "medium" },
          summary: `创建「${block.title}（剩余）」任务`,
        },
      ],
      question: "将剩余工作保存为新任务：",
    };
  }

  /**
   * 执行用户从 PlanProposal 中选择的方案选项。
   * update_time_block 操作前先检测时间冲突。
   */
  async executePlanOption(option: PlanOption): Promise<ExecutePlanOptionResult> {
    // 写操作：先检冲突
    const actionLogIds: string[] = [];
    const confirmedLogId = await this.logProposalEvent("proposal_confirmed", option);
    if (confirmedLogId) actionLogIds.push(confirmedLogId);

    const normalized = this.normalizePlanOption(option);
    if (!normalized.ok) {
      const result = { success: false, message: normalized.message };
      const failedLogId = await this.logProposalEvent(
        "proposal_action_failed",
        option,
        result
      );
      if (failedLogId) actionLogIds.push(failedLogId);
      return { ...result, actionLogIds };
    }

    const actionOption = normalized.option;
    const precheck = await this.precheckPlanAction(actionOption);
    if (!precheck.ok) {
      const result = {
        success: false,
        message: precheck.message ?? "Plan option precheck failed",
      };
      const eventName = precheck.conflictInfo
        ? "proposal_conflict_blocked"
        : "proposal_action_failed";
      const blockedLogId = await this.logProposalEvent(
        eventName,
        actionOption,
        result,
        precheck.conflictInfo
      );
      if (blockedLogId) actionLogIds.push(blockedLogId);
      return { ...result, actionLogIds, conflictInfo: precheck.conflictInfo };
    }

    const result = await this.router.execute(actionOption.toolName, actionOption.params);
    const eventName = result.success
      ? "proposal_action_executed"
      : "proposal_action_failed";
    const actionLogId = await this.logProposalEvent(eventName, actionOption, result);
    if (actionLogId) actionLogIds.push(actionLogId);

    if (result.success) {
      this.trackLastEntities(actionOption.toolName, result);
    }

    return {
      success: result.success,
      message: result.message,
      actionLogIds,
      metadata: {
        toolName: actionOption.toolName,
        relatedTaskId: result.relatedTaskId,
        relatedTimeBlockId: result.relatedTimeBlockId,
        resultType: result.success ? "success" : "failure",
        source: "system",
      },
    };
  }

  private normalizePlanOption(
    option: PlanOption
  ): { ok: true; option: PlanOption } | { ok: false; message: string } {
    const maybeActions = (option as PlanOption & { actions?: SinglePlanAction[] }).actions;
    if (!Array.isArray(maybeActions) || maybeActions.length === 0) {
      return { ok: true, option };
    }

    if (maybeActions.length > 1) {
      return {
        ok: false,
        message:
          "该方案包含多个写操作，当前版本暂不支持自动执行，请拆分或手动确认。",
      };
    }

    const [action] = maybeActions;
    return {
      ok: true,
      option: {
        ...option,
        toolName: action.toolName,
        params: action.params,
        summary: action.summary ?? option.summary,
      },
    };
  }

  private async precheckPlanAction(option: PlanOption): Promise<PlanPrecheckResult> {
    switch (option.toolName) {
      case "create_time_block":
      case "schedule_task":
      case "bind_task_to_time_block":
        return this.precheckTimeRangeAction(option, undefined);
      case "update_time_block":
        return this.precheckUpdateTimeBlockAction(option);
      default:
        return { ok: true };
    }
  }

  private async precheckTimeRangeAction(
    option: PlanOption,
    excludeId: string | undefined
  ): Promise<PlanPrecheckResult> {
    const startTime = option.params.start_time as string | undefined;
    const endTime = option.params.end_time as string | undefined;

    if (!startTime || !endTime) {
      return {
        ok: false,
        message: "缺少完整的开始时间和结束时间，已阻止执行。",
      };
    }

    return this.detectPlanConflict(option.toolName, startTime, endTime, excludeId);
  }

  private async precheckUpdateTimeBlockAction(
    option: PlanOption
  ): Promise<PlanPrecheckResult> {
    const params = option.params;
    const startParam = params.start_time as string | undefined;
    const endParam = params.end_time as string | undefined;

    if (!startParam && !endParam) return { ok: true };

    const timeBlockId = (params.timeBlockId ?? params.blockId) as string | undefined;
    if (!timeBlockId) {
      return { ok: false, message: "缺少时间块 ID，已阻止执行。" };
    }

    const existing = await this.timeBlockService.getBlockById(timeBlockId);
    if (!existing) {
      return { ok: false, message: "时间块不存在，已阻止执行。" };
    }

    const startTime = startParam ?? existing.start_time;
    let endTime = endParam ?? existing.end_time;

    if (startParam && !endParam) {
      const durationMs =
        new Date(existing.end_time).getTime() -
        new Date(existing.start_time).getTime();
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return {
          ok: false,
          message: "无法根据原时间块推导结束时间，已阻止执行。",
        };
      }
      endTime = new Date(new Date(startParam).getTime() + durationMs).toISOString();
    }

    return this.detectPlanConflict(option.toolName, startTime, endTime, timeBlockId);
  }

  private async detectPlanConflict(
    toolName: string,
    startTime: string,
    endTime: string,
    excludeId: string | undefined
  ): Promise<PlanPrecheckResult> {
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      return {
        ok: false,
        message: "时间区间无效，已阻止执行。",
      };
    }

    const conflictResult = await this.router.execute("detect_conflicts", {
      start_time: startTime,
      end_time: endTime,
      excludeId,
    });

    if (!conflictResult.success) {
      return {
        ok: false,
        message: conflictResult.message,
      };
    }

    const data = conflictResult.data as
      | { hasConflict: boolean; conflictingBlocks?: TimeBlock[] }
      | undefined;

    if (!data?.hasConflict) return { ok: true };

    const conflictInfo: PlanConflictInfo = {
      toolName,
      start_time: startTime,
      end_time: endTime,
      excludeId,
      message: conflictResult.message,
      conflictingBlocks: data.conflictingBlocks?.map((block) => ({
        id: block.id,
        title: block.title,
        start_time: block.start_time,
        end_time: block.end_time,
      })),
    };

    return {
      ok: false,
      message: conflictResult.message,
      conflictInfo,
    };
  }

  private async logProposalEvent(
    eventName:
      | "proposal_confirmed"
      | "proposal_action_executed"
      | "proposal_action_failed"
      | "proposal_conflict_blocked",
    option: PlanOption,
    result?: unknown,
    conflictInfo?: PlanConflictInfo
  ): Promise<string | undefined> {
    const timestamp = new Date().toISOString();
    const optionId = option.id ?? option.label ?? option.summary;
    const optionTitle = option.title ?? option.label ?? option.summary;
    const payload = {
      optionId,
      optionTitle,
      toolName: option.toolName,
      params: option.params,
      result: result ?? null,
      conflictInfo: conflictInfo ?? null,
      timestamp,
    };

    try {
      const log = await this.logService.logRequest(
        `[proposal:${eventName}] ${optionTitle}`,
        eventName
      );
      await this.logService.logToolExecution(log.id, option.toolName, payload);
      if (
        eventName === "proposal_action_failed" ||
        eventName === "proposal_conflict_blocked"
      ) {
        const message =
          typeof result === "object" && result !== null && "message" in result
            ? String((result as { message?: unknown }).message)
            : eventName;
        await this.logService.logFailure(log.id, message);
      } else {
        await this.logService.logSuccess(log.id, payload);
      }
      return log.id;
    } catch (e) {
      console.warn("[AgentService] Failed to write proposal audit log:", e);
      return undefined;
    }
  }
}
