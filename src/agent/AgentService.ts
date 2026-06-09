import { ToolRouter } from "@/agent/ToolRouter";
import type { RecentMessage } from "@/agent/llm/contextBuilder";
import { ActionPlanner } from "@/agent/experience/ActionPlanner";
import type { PlannerPort } from "@/agent/experience/PlannerPort";
import type { MemoryAdapter } from "@/agent/memory/MemoryAdapter";
import type { RagAdapter } from "@/agent/memory/RagAdapter";
import type { NotificationAdapter } from "@/agent/notification/NotificationAdapter";
import { RecommendationHandler } from "@/agent/time-management/RecommendationHandler";
import { sanitizeRecommendation } from "@/agent/memory/sanitizeRecommendation";
import {
  ConversationContextBuilder,
  type ConversationMemorySnapshot,
} from "@/agent/experience/ConversationContextBuilder";
import { formatDateKey } from "@/agent/experience/dateFormatting";
import { ResponseBoundary } from "@/agent/experience/ResponseBoundary";
import type { ResponseKind } from "@/agent/experience/ResponseComposer";
import { SemanticFrameParser } from "@/agent/experience/SemanticFrameParser";
import { DomainRoutingService } from "@/agent/router/DomainRoutingService";
import { TimeManagementAgent } from "@/agent/time-management/TimeManagementAgent";
import type { AgentHandler } from "@/agent/handlers/AgentHandler";
import { ExternalInfoHandler } from "@/agent/handlers/ExternalInfoHandler";
import { MetaHandler } from "@/agent/handlers/MetaHandler";
// MetaHandler is used directly for subtype routing (V3.7 P1)
import { FeedbackHandler } from "@/agent/handlers/FeedbackHandler";
import { LowSignalHandler } from "@/agent/handlers/LowSignalHandler";
import { LLMDirectHandler } from "@/agent/handlers/LLMDirectHandler";
import type { LLMClient } from "@/agent/llm/LLMClient";
import { DeepSeekClient } from "@/agent/llm/DeepSeekClient";
import { LLMExperiencePlanner } from "@/agent/llm/LLMExperiencePlanner";
import { CompositePlanner } from "@/agent/CompositePlanner";
import { LLMChatExecutor } from "@/agent/llm/LLMChatExecutor";
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
  SinglePlanAction,
} from "@/agent/types";
import type { FreeSlot } from "@/agent/tools/schedule/getFreeSlotsTool";
import { formatTime } from "@/lib/dateUtils";
import type { TimeBlock } from "@/types/timeblock.types";
import { ActionLogService } from "@/services/ActionLogService";
import { ConfirmationService } from "@/services/ConfirmationService";
import { ScheduleService } from "@/services/ScheduleService";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";

import { AvailabilityProvider } from "@/agent/time-management/scheduling/AvailabilityProvider";
import { RecommendationPlanner } from "@/agent/time-management/scheduling/RecommendationPlanner";
import { SchedulingReasoner } from "@/agent/time-management/scheduling/SchedulingReasoner";
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
  /** V3.7 P1: 透传 PlanOption.uiAction，UI 层处理后续动作 */
  uiAction?: PlanOption["uiAction"];
  /** V3.7 P1: 透传 ToolResult.relatedTaskId，供 split_then_recommend 使用 */
  relatedTaskId?: string;
}

interface PlanPrecheckResult {
  ok: boolean;
  message?: string;
  conflictInfo?: PlanConflictInfo;
}

// SinglePlanAction is now exported from @/agent/types (V3.7)

// ─── ProcessInput 调用上下文（V3 新增） ─────────────────────────────────────

export interface ProcessInputContext {
  /** chatStore 传入的最近消息，用于 LLM 指代消解 */
  recentMessages?: RecentMessage[];
  timezone?: string;
  currentTimelineDate?: string;
  selectedDate?: string;
  currentScreen?: string;
  /**
   * V3.7 P1: 当前存在的 pending confirmation ID。
   * chatStore 在 sendMessage 时从最近消息中提取并传入，
   * 供 ContextualPreRouter 检测"好/取消"等快捷确认输入。
   */
  pendingConfirmationId?: string;
  /**
   * V3.7 P1: 当前是否处于 pending clarification 状态。
   */
  pendingClarification?: boolean;
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
  /** Phase 1+: 可替换的 Planner 实现（默认使用 CompositePlanner）。测试时可注入 StubPlanner。 */
  plannerPort?: PlannerPort;
  /**
   * V3.7: 注入 LLM 客户端。
   * - 不传：使用默认 DeepSeekClient（读取 VITE_LLM_AGENT_ENABLED 环境变量）。
   * - 传 undefined 显式禁用 LLM，只走规则路径。
   * - 测试时注入 MockLLMClient。
   */
  llmClient?: LLMClient | null;
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
  private domainRoutingService: DomainRoutingService;
  private timeManagementAgent: TimeManagementAgent;
  private handlers: Map<AgentDomain, AgentHandler>;

  // Phase 1+: 可选适配器（mock 或未来真实实现）
  //
  // ─── Memory / RAG 架构说明（V3.8+ 工具化预留） ───────────────────────────
  //
  // memoryAdapter：
  // - 当前仍服务于 RecommendationHandler 的隐式建议链路（后置注脚）。
  // - 长期目标：通过 memory_retrieve / memory_record 工具暴露给 Agent，
  //   而不是散落在业务代码里的隐式状态。
  // - memory_retrieve：只读低风险工具（见 src/agent/tools/memory/memoryRetrieveTool.ts）。
  // - memory_record：涉及长期状态写入，未来需去重/置信度/确认策略，当前不注册。
  //
  // ragAdapter：
  // - 当前还服务于 ragContext 的过渡式 RAG-before-LLM prompt 注入
  //   （见 src/agent/llm/ragContext.ts → LLMExperiencePlanner.plan()）。
  // - 长期目标：通过 rag_retrieve 工具暴露给 Agent 主动调用
  //   （见 src/agent/tools/rag/ragRetrieveTool.ts），不再扩大隐式 prompt 注入。
  //
  // 本阶段只预留接口与注释，不切换主链路。详见：
  // docs/V3.8/RAG_AND_MEMORY_TOOLIZATION_NOTES.md
  //
  readonly memoryAdapter: MemoryAdapter | undefined;
  readonly ragAdapter: RagAdapter | undefined;
  readonly notificationAdapter: NotificationAdapter | undefined;

  // V3.8: 只有当至少一个 memory/rag 适配器被注入时才创建建议处理器。
  // 主链路不强依赖；附加的 suggestion 注脚走静默降级，不影响执行结果。
  private recommendationHandler: RecommendationHandler | undefined;

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
    this.responseBoundary = new ResponseBoundary();
    this.memoryAdapter = options.memoryAdapter;
    this.ragAdapter = options.ragAdapter;
    this.notificationAdapter = options.notificationAdapter;

    // V3.7: 组装 plannerPort
    // 优先级：显式传入的 plannerPort（测试用）> CompositePlanner（生产）
    if (options.plannerPort) {
      this.plannerPort = options.plannerPort;
    } else {
      // options.llmClient === null 时显式禁用 LLM
      const rulePlanner = new ActionPlanner(this.taskService);
      // this.router 在 registerTools() 之前为空注册表，但 LLMExperiencePlanner
      // 只在 plan() 时查 router，所以可以在 registerTools() 之前创建
      let llmPlanner: LLMExperiencePlanner | undefined;
      if (options.llmClient !== null) {
        const client = options.llmClient ?? this.createDefaultLLMClient();
        if (client) {
          // V3.8+: 注入 ragAdapter，让 LLMExperiencePlanner 在调用 client.chat()
          // 之前用 RAG 检索 snippets 并注入到 messages。
          // 注意：DomainRoutingService 不接 ragAdapter，避免影响路由稳定性。
          llmPlanner = new LLMExperiencePlanner(client, this.router, {
            ragAdapter: this.ragAdapter,
          });
        }
      }
      this.plannerPort = new CompositePlanner(llmPlanner, rulePlanner);
    }

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
    // V3.7: 为只读域创建 LLMChatExecutor（与 time_management 共用同一个 LLM client）
    const resolvedLLMClient = options.llmClient !== null
      ? (options.llmClient ?? this.createDefaultLLMClient())
      : undefined;
    const chatExecutor = resolvedLLMClient
      ? new LLMChatExecutor(resolvedLLMClient)
      : undefined;

    // V3.7 P1: 三段式域路由服务（DomainRoutingService 内部管理 fallback router）
    this.domainRoutingService = new DomainRoutingService(resolvedLLMClient);

    this.handlers = new Map<AgentDomain, AgentHandler>([
      ["general_chat", new LLMDirectHandler("general_chat", chatExecutor)],
      ["knowledge_qa", new LLMDirectHandler("knowledge_qa", chatExecutor)],
      ["writing_assistant", new LLMDirectHandler("writing_assistant", chatExecutor)],
      ["external_info", new ExternalInfoHandler()],
      ["assistant_meta", new MetaHandler()],
      ["feedback_or_complaint", new FeedbackHandler()],
      ["low_signal", new LowSignalHandler()],
    ]);

    // V3.8: 按需创建 RecommendationHandler。
    // 任一适配器存在即可启用，便于未来分别接入真实 Memory / 真实 RAG。
    if (this.memoryAdapter || this.ragAdapter) {
      this.recommendationHandler = new RecommendationHandler({
        memoryAdapter: this.memoryAdapter,
        ragAdapter: this.ragAdapter,
      });
    }

    this.registerTools();
  }

  private createDefaultLLMClient(): LLMClient | undefined {
    const enabled = (import.meta.env?.VITE_LLM_AGENT_ENABLED as string | undefined) === "true";
    if (!enabled) return undefined;
    return new DeepSeekClient();
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

    // ─── 未注册的 Tool 化预留（V3.8+） ─────────────────────────────────────
    // 当前不注册以下工具：
    // - RagRetrieveTool     (src/agent/tools/rag/ragRetrieveTool.ts)
    // - MemoryRetrieveTool  (src/agent/tools/memory/memoryRetrieveTool.ts)
    // - MemoryRecordTool    (src/agent/tools/memory/memoryRecordTool.ts)
    //
    // 也不把它们加入 prompts.ts 的 TOOL_DESCRIPTIONS 工具白名单，
    // 避免 LLM 当前阶段就开始主动调用知识 / 记忆工具。
    //
    // 原因：
    // - 当前 LLMExperiencePlanner 仍是单轮 JSON plan，不具备稳定的
    //   tool -> observation -> replan 循环。
    // - 如果暴露 rag_retrieve / memory_retrieve，LLM 可能只检索 RAG/Memory
    //   就结束，无法继续基于结果调用 schedule_task / get_today_plan 等工具，
    //   反而降低时间管理主链路稳定性。
    // - memory_record 涉及长期状态写入，需要更严格的去重 / 置信度 /
    //   用户可见性 / confirmation 策略，未落地前不应让 LLM 随意写。
    //
    // 当前 RAG 上下文走的是过渡链路：
    //   src/agent/llm/ragContext.ts → LLMExperiencePlanner.plan() 内的 system block 注入
    // 当前 Memory 仍以 memoryAdapter 形式服务于 RecommendationHandler 的隐式建议链路。
    //
    // 后续工具化路线（不在本次范围）：
    //   this.router.register(new RagRetrieveTool(this.ragAdapter));
    //   this.router.register(new MemoryRetrieveTool(this.memoryAdapter));
    //   this.router.register(new MemoryRecordTool(this.memoryAdapter));
    //
    // 详见 docs/V3.8/RAG_AND_MEMORY_TOOLIZATION_NOTES.md
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
    const route = await this.domainRoutingService.classify(userInput, {
      pendingConfirmationId: context?.pendingConfirmationId,
      pendingClarification: context?.pendingClarification,
      lastAssistantText: (() => {
        const assistantMsgs = context?.recentMessages?.filter((m) => m.role === "assistant") ?? [];
        return assistantMsgs[assistantMsgs.length - 1]?.content;
      })(),
      timezone: context?.timezone,
    });

    // V3.7 P1: Contextual pre-router 检测到 pending confirmation 快捷回复
    if (route.pendingAction) {
      const { kind, confirmationId } = route.pendingAction;
      if (kind === "confirm") {
        return this.confirmAction(confirmationId);
      } else if (kind === "reject") {
        return this.rejectAction(confirmationId);
      } else if (kind === "adjust_later" || kind === "adjust_earlier") {
        return this.adjustRecommendation(confirmationId, kind, experienceContext);
      }
    }

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

      // V3.8: 当存在 RecommendationHandler 且无待确认项时，附加建议注脚。
      // 建议注脚只是消息层修饰，不创建 confirmation、不写 ActionLog、不触发刷新。
      const finalMessage = await this.maybeAppendRecommendation(
        handled.response.message ?? "",
        handled.response.confirmationId,
        experienceContext,
        userInput,
      );

      return {
        message: finalMessage,
        intent: handled.intent,
        toolResult: handled.response.toolResults?.[0],
        refreshHints: handled.response.refreshHints,
        actionLogId: handled.metadata.actionLogId,
        confirmationId: handled.response.confirmationId,
        metadata: handled.metadata,
      };
    }

    // V3.7 P1: MetaHandler 支持传入 LLM 检测到的 subtype
    let handlerResult: AgentHandlerResult;
    if (route.domain === "assistant_meta") {
      const metaHandler = this.handlers.get("assistant_meta") as MetaHandler | undefined;
      if (metaHandler) {
        handlerResult = metaHandler.handleWithSubtype(userInput, experienceContext, route.subtype);
      } else {
        handlerResult = { domain: "assistant_meta", responseKind: "meta_identity" };
      }
    } else {
      const handler = this.handlers.get(route.domain);
      handlerResult = handler
        ? await handler.handle(userInput, experienceContext)
        : { domain: "general_chat", responseKind: "general" };
    }

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
      routerSource: route.routerSource,
      llmDecision: route.llmDecision,
      routerFallbackReason: route.fallbackReason,
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
    // 先刷新过期状态，防止前端持有 pending confirmation 但实际已超时
    await this.confirmService.expireStale();

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

    try {
      await this.confirmService.confirm(confirmationId);
    } catch (e) {
      // 过期或其他状态异常 → stale 分支
      return {
        message: this.composeBoundaryMessage("", undefined, "confirmation_stale"),
        intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
      };
    }

    const args = JSON.parse(confirmation.tool_args_json) as Record<string, unknown>;

    // 记录确认执行日志
    const log = await this.logService.logRequest(
      `[确认执行] ${confirmation.action_type}`,
      confirmation.action_type
    );
    await this.logService.logToolExecution(log.id, confirmation.tool_name, args);

    // V3.7: 若 args.actions[] 存在（batch_action / defer_task），按序执行
    const decomposedActions = args.actions as SinglePlanAction[] | undefined;
    const isBatchKind =
      confirmation.tool_name === "batch_action" ||
      confirmation.tool_name === "defer_task";

    if (isBatchKind && Array.isArray(decomposedActions) && decomposedActions.length > 0) {
      const batchResult = await this.executeActionList(decomposedActions, log.id, confirmationId);
      return batchResult;
    }

    // 单 tool 执行（原路径）
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

  // ─── 时间调整：重新推荐更晚/更早的时段 ────────────────────────────────────

  private async adjustRecommendation(
    confirmationId: string,
    direction: "adjust_later" | "adjust_earlier",
    context: import("@/agent/types").AgentExperienceContext
  ): Promise<AgentResponse> {
    const confirmation = await this.confirmService.getById(confirmationId);
    if (!confirmation || confirmation.status !== "pending") {
      return {
        message: this.composeBoundaryMessage("", undefined, "confirmation_stale"),
        intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
      };
    }

    const prevArgs = JSON.parse(confirmation.tool_args_json) as Record<string, unknown>;
    const prevTitle = String(prevArgs.title ?? "新任务");
    const prevDuration = Number(prevArgs.estimated_duration_minutes ?? prevArgs.duration ?? 30);
    const prevEnd = prevArgs.end_time as string | undefined;
    const prevStart = prevArgs.start_time as string | undefined;

    // 取消旧的 pending recommendation
    try { await this.confirmService.reject(confirmationId); } catch { /* ignore */ }

    // 计算新的推荐起点约束
    const now = new Date(context.currentDatetime);
    let notBefore: Date;
    if (direction === "adjust_later") {
      // 从上次推荐的结束时间之后开始找（至少也不早于 now+buffer）
      notBefore = prevEnd ? new Date(prevEnd) : now;
    } else {
      // 提前：从上次推荐起点减 duration 前开始（不得早于 now+buffer）
      const prevStartMs = prevStart ? new Date(prevStart).getTime() : now.getTime();
      notBefore = new Date(Math.max(prevStartMs - prevDuration * 60 * 1000, now.getTime()));
    }

    // 重新用 RecommendationPlanner 推荐，notBefore 作为自定义 "now" 以跳过已推荐时段
    const availabilityProvider = new AvailabilityProvider(this.timeBlockService);
    const reasoner = new SchedulingReasoner();
    const planner = new RecommendationPlanner(availabilityProvider, reasoner);

    const candidates = await planner.plan({
      date: now,
      durationMinutes: prevDuration,
      timezone: context.timezone,
      now: notBefore,
      bufferMinutes: 0, // notBefore 已经是截断点，不再叠加 buffer
    });

    const log = await this.logService.logRequest(
      `[调整推荐:${direction}] ${prevTitle}`,
      "adjust_recommendation"
    );

    let newConfirmationId: string | undefined;
    if (candidates.length > 0) {
      const rec = candidates[0];
      const newPending = await this.confirmService.createConfirmation({
        action_type: confirmation.action_type,
        tool_name: "schedule_task",
        tool_args_json: JSON.stringify({
          title: prevTitle,
          category: prevArgs.category,
          duration: prevDuration,
          estimated_duration_minutes: prevDuration,
          start_time: rec.start,
          end_time: rec.end,
        }),
        risk_level: "low",
        description: `按调整后时间安排「${prevTitle}」`,
      });
      newConfirmationId = newPending.id;
      await this.logService.logSuccess(log.id, { newConfirmationId, recommendation: rec });

      const startStr = new Date(rec.start).toLocaleTimeString("zh-CN", {
        hour: "2-digit", minute: "2-digit", timeZone: context.timezone,
      });
      const endStr = new Date(rec.end).toLocaleTimeString("zh-CN", {
        hour: "2-digit", minute: "2-digit", timeZone: context.timezone,
      });
      const message = `那改到 ${startStr} - ${endStr} 怎么样，需要我按这个时间来安排吗？`;

      const metadata: ChatMessageMetadata = {
        intent: confirmation.action_type,
        confirmationId: newConfirmationId,
        actionLogId: log.id,
        resultType: "pending_confirmation",
        source: "llm",
        llmResponseType: "clarification",
      };

      return {
        message,
        intent: { intent: "unknown", confidence: 0.95, args: {}, rawInput: "" },
        confirmationId: newConfirmationId,
        metadata,
      };
    }

    // 没有更多可用时段
    await this.logService.logSuccess(log.id, { candidates: 0 });
    return {
      message: "今天已经没有更合适的时间段了，你可以手动选择一个时间或者换一天安排。",
      intent: { intent: "unknown", confidence: 0.8, args: {}, rawInput: "" },
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

  // ─── V3.7: batch/defer 原子操作顺序执行器 ────────────────────────────────

  private async executeActionList(
    actions: SinglePlanAction[],
    parentLogId: string,
    confirmationId: string
  ): Promise<AgentResponse> {
    const toolResults: AgentToolResult[] = [];
    const refreshHints: AgentRefreshHints = { tasks: true, timeline: true };

    for (const action of actions) {
      await this.logService.logToolExecution(
        parentLogId,
        action.toolName,
        action.params
      );
      const result = await this.router.execute(action.toolName, action.params);
      toolResults.push(result);

      if (!result.success) {
        // short-circuit：第一个失败就停止
        await this.logService.logFailure(
          parentLogId,
          result.error ?? result.message
        );
        const metadata: ChatMessageMetadata = {
          toolName: action.toolName,
          actionLogId: parentLogId,
          confirmationId,
          resultType: "failure",
          source: "chat",
        };
        return {
          message: this.composeBoundaryMessage(
            "",
            undefined,
            "tool_failure",
            toolResults
          ),
          intent: { intent: "unknown", confidence: 1, args: {}, rawInput: "" },
          toolResult: result,
          actionLogId: parentLogId,
          metadata,
          refreshHints,
        };
      }

      this.trackLastEntities(action.toolName, result);
    }

    await this.logService.logSuccess(parentLogId, {
      executedActions: toolResults.length,
    });

    const metadata: ChatMessageMetadata = {
      actionLogId: parentLogId,
      confirmationId,
      resultType: "success",
      source: "chat",
    };

    return {
      message: this.composeBoundaryMessage(
        "",
        undefined,
        "tool_success",
        toolResults
      ),
      intent: { intent: "unknown", confidence: 1, args: {}, rawInput: "" },
      toolResult: toolResults[toolResults.length - 1],
      actionLogId: parentLogId,
      metadata,
      refreshHints,
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

  /**
   * V3.8: 在 time_management 主回复末尾按需追加 RecommendationHandler 注脚。
   *
   * 触发条件：
   * - recommendationHandler 已初始化（即注入了 memoryAdapter 或 ragAdapter）。
   * - 当前响应无 confirmationId（不打断确认流）。
   *
   * 追加条件：
   * - rec.suggestionKind 为 "suggestion" 或 "confirmation_required" 时追加。
   * - "executable_action"（计划合理）不追加。
   *
   * RAG query 构造策略（优先级递减）：
   * 1. userInput（用户原始输入，语义最丰富）。
   * 2. todayBlocks 标题拼接（退回上下文）。
   * 3. 空字符串（最终退回，RAG 跳过检索）。
   *
   * 失败路径静默降级：任何异常都不应阻塞主响应。
   */
  private async maybeAppendRecommendation(
    baseMessage: string,
    confirmationId: string | undefined,
    experienceContext: import("@/agent/types").AgentExperienceContext,
    userInput?: string,
  ): Promise<string> {
    if (!this.recommendationHandler) return baseMessage;
    if (confirmationId) return baseMessage;

    try {
      const today = new Date(experienceContext.currentDatetime);
      const blocks = await this.timeBlockService.getBlocksForDate(today);
      const lightweightBlocks = blocks.map((b) => ({
        title: b.title,
        start_time: b.start_time,
        end_time: b.end_time,
      }));

      // 构建语义化 RAG query：用户输入是语义最丰富的信号，
      // 比 currentDatetime 更有利于匹配 seed knowledge 中的时间管理理论。
      const blockTitles = lightweightBlocks.map((b) => b.title).filter(Boolean).join(" ");
      const ragQuery = (userInput?.trim() || blockTitles || "").trim();

      const rec = await this.recommendationHandler.generateRecommendation(
        experienceContext,
        lightweightBlocks,
        ragQuery,
      );
      if (
        rec.suggestionKind === "executable_action" ||
        !rec.message ||
        !rec.message.trim()
      ) {
        return baseMessage;
      }

      // V3.8: sanitize 确保 RAG 内容不暴露内部名称、JSON 指令或命令口吻。
      const safeMessage = sanitizeRecommendation(rec.message);
      if (!safeMessage) return baseMessage;

      const separator = baseMessage.trim() ? "\n\n---\n" : "";
      return `${baseMessage}${separator}💡 ${safeMessage}`;
    } catch (err) {
      console.warn("maybeAppendRecommendation failed:", err);
      return baseMessage;
    }
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
    const today = formatDateKey(new Date());
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

    // split: 创建剩余任务 — V3.7 P1 提供 3 个方案
    const remainingTitle = `${block.title}（剩余）`;
    const durationMs =
      new Date(block.end_time).getTime() - new Date(block.start_time).getTime();
    const durationMinutes = Math.round(durationMs / 60000) || 30;

    return {
      mode: "propose",
      options: [
        {
          id: "split_create_only",
          label: `仅创建「${remainingTitle}」，暂不安排`,
          toolName: "create_task",
          params: { title: remainingTitle, priority: "medium" },
          summary: `创建「${remainingTitle}」任务`,
        },
        {
          id: "split_create_recommend",
          label: `创建「${remainingTitle}」并由我推荐时间`,
          toolName: "create_task",
          params: { title: remainingTitle, priority: "medium" },
          summary: `创建「${remainingTitle}」任务，安排到推荐时间`,
          uiAction: { kind: "split_then_recommend" as const, durationMinutes },
        },
        {
          id: "split_create_manual",
          label: `创建「${remainingTitle}」，我自己选时间`,
          toolName: "create_task",
          params: { title: remainingTitle, priority: "medium" },
          summary: `创建「${remainingTitle}」任务，手动选择时间`,
          uiAction: { kind: "open_schedule_dialog" as const, defaultDurationMinutes: durationMinutes },
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
      // V3.7 P1: 透传 uiAction，UI 层据此打开调度对话框或触发推荐流程
      uiAction: result.success ? option.uiAction : undefined,
      relatedTaskId: result.relatedTaskId,
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
