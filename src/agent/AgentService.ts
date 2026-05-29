import { IntentParser } from "@/agent/IntentParser";
import { ToolRouter } from "@/agent/ToolRouter";
import { DeepSeekClient } from "@/agent/llm/DeepSeekClient";
import { ContextBuilder } from "@/agent/llm/contextBuilder";
import type { RecentMessage } from "@/agent/llm/contextBuilder";
import { LLMPlanner } from "@/agent/LLMPlanner";
import { ActionPlanner } from "@/agent/experience/ActionPlanner";
import {
  ConversationContextBuilder,
  type ConversationMemorySnapshot,
} from "@/agent/experience/ConversationContextBuilder";
import {
  ResponseComposer,
  type ResponseKind,
} from "@/agent/experience/ResponseComposer";
import { SemanticFrameParser } from "@/agent/experience/SemanticFrameParser";
import type {
  AgentActionPlan,
  AgentCommand,
  AgentExperienceContext,
  AgentRefreshHints,
  AgentToolResult,
  AgentTrace,
  ChatMessageMetadata,
  ExperienceActionPlan,
  IntentType,
  ParsedIntent,
  PlanOption,
  PlanProposal,
  RiskLevel,
  SemanticFrame,
} from "@/agent/types";
import { CONFIRMATION_POLICY, toLegacyRiskLevel } from "@/agent/types";
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

// ─── Intent → Tool 映射表（snake_case，与 IntentType 和 Tool.name 三处一致） ──

const INTENT_TO_TOOL: Record<string, string> = {
  create_task: "create_task",
  list_tasks: "list_tasks",
  update_task: "update_task",
  delete_task: "delete_task",
  mark_task_completed: "mark_task_completed",
  create_time_block: "create_time_block",
  move_time_block: "update_time_block",
  delete_time_block: "delete_time_block",
  list_time_blocks: "list_time_blocks",
  bind_task_to_time_block: "bind_task_to_time_block",
  schedule_task: "schedule_task",
  reschedule_day: "reschedule_day",
  detect_conflicts: "detect_conflicts",
  get_free_slots: "get_free_slots",
  get_today_plan: "get_today_plan",
  explain_task: "explain_task",
  explain_schedule: "explain_schedule",
};

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
}

// ─── AgentService ───────────────────────────────────────────────────────────

export class AgentService {
  private parser: IntentParser;
  private router: ToolRouter;
  private logService: ActionLogPort;
  private confirmService: ConfirmationService;
  private taskService: TaskService;
  private timeBlockService: TimeBlockService;
  private scheduleService: ScheduleService;

  // V3：LLM 相关组件
  private llmPlanner: LLMPlanner;
  private contextBuilder: ContextBuilder;
  private experienceContextBuilder: ConversationContextBuilder;
  private semanticFrameParser: SemanticFrameParser;
  private actionPlanner: ActionPlanner;
  private responseComposer: ResponseComposer;

  private lastOperatedTaskId: string | null = null;
  private lastOperatedTimeBlockId: string | null = null;
  private lastCreatedTaskId: string | null = null;
  private lastMentionedTaskIds: string[] = [];
  private lastScheduledTimeBlockIds: string[] = [];
  private lastToolResults: AgentToolResult[] = [];

  constructor(options: AgentServiceOptions = {}) {
    this.parser = new IntentParser();
    this.router = new ToolRouter();
    this.logService = options.logService ?? new ActionLogService();
    this.confirmService = options.confirmService ?? new ConfirmationService();
    this.taskService = options.taskService ?? new TaskService();
    this.timeBlockService = options.timeBlockService ?? new TimeBlockService();
    this.scheduleService = options.scheduleService ?? new ScheduleService();

    // V3：初始化 LLM 组件（通过 LLMClient 接口隔离，不直接依赖 fetch）
    const llmClient = new DeepSeekClient();
    this.llmPlanner = new LLMPlanner(llmClient, this.router);
    this.contextBuilder = new ContextBuilder(this.taskService, this.timeBlockService);
    this.experienceContextBuilder = new ConversationContextBuilder();
    this.semanticFrameParser = new SemanticFrameParser();
    this.actionPlanner = new ActionPlanner(this.taskService);
    this.responseComposer = new ResponseComposer();

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
    const experienceContext = this.experienceContextBuilder.build(
      context,
      this.getConversationMemorySnapshot()
    );
    const semanticFrame = this.semanticFrameParser.parse(userInput);

    const llmEnabled =
      (import.meta.env.VITE_LLM_AGENT_ENABLED as string | undefined) === "true";
    const apiKey = (import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined) ?? "";

    if (
      semanticFrame.userGoal !== "general_chat" ||
      !llmEnabled ||
      !apiKey
    ) {
      return this.processWithExperiencePipeline(
        userInput,
        experienceContext,
        semanticFrame
      );
    }

    // LLM 未启用：返回配置错误，不走规则链路
    if (!llmEnabled) {
      const log = await this.logService.logRequest(userInput, "unknown");
      await this.logService.logFailure(log.id, "LLM Agent 未启用");
      const trace: AgentTrace = { planner: "llm", mode: "error", errorKind: "disabled" };
      return {
        message:
          "⚠️ LLM Agent 未启用。请在 .env 文件中设置 VITE_LLM_AGENT_ENABLED=true 后重启服务。",
        intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
        actionLogId: log.id,
        metadata: { intent: "unknown", actionLogId: log.id, resultType: "failure", source: "llm", agentTrace: trace },
      };
    }

    // API Key 未配置：返回配置错误，不走规则链路
    if (!apiKey) {
      const log = await this.logService.logRequest(userInput, "unknown");
      await this.logService.logFailure(log.id, "API Key 未配置");
      const trace: AgentTrace = { planner: "llm", mode: "error", errorKind: "api_key_missing" };
      return {
        message:
          "⚠️ 尚未配置 DeepSeek API Key。请在 .env 文件中设置 VITE_DEEPSEEK_API_KEY 后重启服务。",
        intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
        actionLogId: log.id,
        metadata: { intent: "unknown", actionLogId: log.id, resultType: "failure", source: "llm", agentTrace: trace },
      };
    }

    // LLM 路径：直接返回，不捕获异常降级到规则链路
    return this.processWithLLM(userInput, context);
  }

  // ─── LLM 路径（V3.5：不再返回 null，所有结果写入 AgentTrace） ─────────────

  private async processWithExperiencePipeline(
    userInput: string,
    context: AgentExperienceContext,
    semanticFrame: SemanticFrame
  ): Promise<AgentResponse> {
    const actionPlan = await this.actionPlanner.plan(semanticFrame, context);
    const toolResults: AgentToolResult[] = [];
    let queryBlocks: TimeBlock[] | undefined;
    let actionLogId: string | undefined;

    const log = await this.logService.logRequest(userInput, semanticFrame.userGoal);
    actionLogId = log.id;

    if (actionPlan.kind === "tool" && actionPlan.toolName) {
      await this.logService.logToolExecution(
        log.id,
        actionPlan.toolName,
        actionPlan.params
      );
      const result = await this.router.execute(
        actionPlan.toolName,
        actionPlan.params
      );
      toolResults.push(result);

      if (result.success) {
        await this.logService.logSuccess(log.id, result.data);
        this.trackLastEntities(actionPlan.toolName, result);
        this.updateExperienceMemory(semanticFrame, actionPlan, result);
      } else {
        await this.logService.logFailure(log.id, result.error ?? result.message);
      }
    } else if (actionPlan.kind === "query_schedule") {
      const taskId = actionPlan.params.taskId as string | null | undefined;

      if (taskId) {
        const blocks = await this.timeBlockService.getBlocksByTaskId(taskId);
        queryBlocks = blocks
          .filter((block) => !block.deleted_at)
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
        this.rememberMentionedTask(taskId);
      } else {
        queryBlocks = [];
      }

      const queryResult: AgentToolResult = {
        success: Boolean(taskId && queryBlocks.length > 0),
        message: "query schedule",
        data: queryBlocks,
        relatedTaskId: taskId ?? undefined,
        relatedTimeBlockId: queryBlocks[0]?.id,
      };
      toolResults.push(queryResult);
      await this.logService.logSuccess(log.id, {
        taskId: taskId ?? null,
        timeBlocks: queryBlocks,
      });
    } else {
      await this.logService.logSuccess(log.id, {
        kind: actionPlan.kind,
        userGoal: semanticFrame.userGoal,
      });
    }

    const finalResponse = this.responseComposer.compose({
      context,
      frame: semanticFrame,
      plan: actionPlan,
      toolResults,
      queryBlocks,
    });

    const traceMode =
      actionPlan.kind === "direct_response"
        ? "direct_response"
        : actionPlan.kind === "query_schedule"
          ? "query_schedule"
          : actionPlan.kind === "chat"
            ? "chitchat"
            : "tool_plan";

    const trace: AgentTrace = {
      planner: "experience",
      mode: traceMode,
      toolName: actionPlan.toolName,
      rawInput: userInput,
      contextSnapshot: context,
      semanticFrame,
      actionPlan,
      toolResults,
      finalResponse,
    };

    const primaryResult = toolResults[0];
    const mappedIntent: IntentType =
      semanticFrame.userGoal === "create_and_schedule_task"
        ? "schedule_task"
        : "unknown";

    const metadata: ChatMessageMetadata = {
      intent: semanticFrame.userGoal,
      toolName: actionPlan.toolName,
      actionLogId,
      relatedTaskId:
        primaryResult?.relatedTaskId ??
        (actionPlan.params.taskId as string | undefined),
      relatedTimeBlockId: primaryResult?.relatedTimeBlockId,
      resultType: primaryResult && !primaryResult.success ? "failure" : "success",
      source: "llm",
      confidence: semanticFrame.confidence,
      llmResponseType: traceMode === "chitchat" ? "chitchat" : "tool_plan",
      agentTrace: trace,
    };

    return {
      message: finalResponse,
      intent: {
        intent: mappedIntent,
        confidence: semanticFrame.confidence,
        args: actionPlan.params,
        rawInput: userInput,
      },
      toolResult: primaryResult,
      actionLogId,
      refreshHints: actionPlan.refreshHints,
      metadata,
    };
  }

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

    return this.responseComposer.compose({
      context: experienceContext,
      frame: semanticFrame,
      plan,
      toolResults,
      responseKind,
    });
  }

  private async processWithLLM(
    userInput: string,
    context?: ProcessInputContext
  ): Promise<AgentResponse> {
    // 构造上下文
    const llmContext = await this.contextBuilder.build(
      context?.recentMessages ?? [],
      this.lastOperatedTaskId,
      this.lastOperatedTimeBlockId
    );

    // 调用 LLMPlanner（内部已处理所有异常，不会抛出）
    const planResult = await this.llmPlanner.plan(userInput, llmContext);
    const modelName = planResult.modelName;

    switch (planResult.type) {
      case "api_key_missing": {
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, planResult.errorMessage ?? "API Key 缺失");
        const trace: AgentTrace = { planner: "llm", mode: "error", model: modelName, errorKind: "api_key_missing" };
        return {
          message: this.composeBoundaryMessage(userInput, context, "unsupported_intent"),
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: { intent: "unknown", actionLogId: log.id, resultType: "failure", source: "llm", llmModel: modelName, agentTrace: trace },
        };
      }

      case "network_error": {
        console.warn("[AgentService] LLM 网络错误：", planResult.errorMessage);
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, planResult.errorMessage ?? "网络错误");
        const trace: AgentTrace = { planner: "llm", mode: "error", model: modelName, errorKind: "network_error" };
        return {
          message: this.composeBoundaryMessage(userInput, context, "unsupported_intent"),
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: { intent: "unknown", actionLogId: log.id, resultType: "failure", source: "llm", llmModel: modelName, agentTrace: trace },
        };
      }

      case "parse_error": {
        console.warn("[AgentService] LLM 输出解析失败：", planResult.errorMessage);
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, planResult.errorMessage ?? "解析失败");
        const trace: AgentTrace = { planner: "llm", mode: "error", model: modelName, errorKind: "parse_error" };
        return {
          message: this.composeBoundaryMessage(userInput, context, "unsupported_intent"),
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: { intent: "unknown", actionLogId: log.id, resultType: "failure", source: "llm", llmModel: modelName, agentTrace: trace },
        };
      }

      case "fallback": {
        console.warn("[AgentService] LLM fallback：", planResult.errorMessage);
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, planResult.errorMessage ?? "fallback");
        const trace: AgentTrace = { planner: "llm", mode: "error", model: modelName, errorKind: "fallback" };
        return {
          message: this.composeBoundaryMessage(userInput, context, "unsupported_intent"),
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: { intent: "unknown", actionLogId: log.id, resultType: "failure", source: "llm", llmModel: modelName, agentTrace: trace },
        };
      }

      case "clarification": {
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, "LLM 追问：信息不足");
        const trace: AgentTrace = { planner: "llm", mode: "clarification", model: modelName };
        return {
          message: this.composeBoundaryMessage(userInput, context, "clarification"),
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: {
            intent: "unknown", actionLogId: log.id, resultType: "failure", source: "llm",
            llmModel: modelName, confidence: planResult.confidence, llmResponseType: "clarification", agentTrace: trace,
          },
        };
      }

      case "chitchat": {
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, "LLM 闲聊响应");
        const trace: AgentTrace = { planner: "llm", mode: "chitchat", model: modelName };
        return {
          message: this.composeBoundaryMessage(userInput, context, "general_chat"),
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: {
            intent: "unknown", actionLogId: log.id, resultType: "failure", source: "llm",
            llmModel: modelName, confidence: planResult.confidence, llmResponseType: "chitchat", agentTrace: trace,
          },
        };
      }

      case "unsupported": {
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, "LLM 判断：超出能力范围");
        const trace: AgentTrace = { planner: "llm", mode: "unsupported", model: modelName };
        return {
          message: this.composeBoundaryMessage(userInput, context, "unsupported_intent"),
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: {
            intent: "unknown", actionLogId: log.id, resultType: "failure", source: "llm",
            llmModel: modelName, confidence: planResult.confidence, llmResponseType: "unsupported", agentTrace: trace,
          },
        };
      }

      case "tool_plan": {
        const trace: AgentTrace = { planner: "llm", mode: "tool_plan", model: modelName, toolName: planResult.toolName };
        return this.executeToolPlan(
          userInput,
          planResult.intent!,
          planResult.toolName!,
          planResult.params ?? {},
          planResult.requiresConfirmation ?? false,
          planResult.riskLevel ?? "safe",
          planResult.summary ?? planResult.toolName!,
          {
            source: "llm",
            llmModel: modelName,
            confidence: planResult.confidence,
            llmResponseType: "tool_plan",
            agentTrace: trace,
          }
        );
      }

      default: {
        // 防御性分支，理论上不可达
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, "LLM 未知响应类型");
        const trace: AgentTrace = { planner: "llm", mode: "error", model: modelName, errorKind: "fallback" };
        return {
          message: this.composeBoundaryMessage(userInput, context, "unsupported_intent"),
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: { intent: "unknown", actionLogId: log.id, resultType: "failure", source: "llm", llmModel: modelName, agentTrace: trace },
        };
      }
    }
  }

  // ─── 规则路径（已弃用，仅保留供 dev-only 调试；V3.5 Chat 主链路不再调用） ──

  /**
   * @deprecated V3.5 后 Chat 主链路不再调用此方法。
   * 保留供开发调试使用，未来可删除或仅在 dev 模式下暴露。
   * 标记为 protected 而非 private，以避免 noUnusedLocals 编译错误。
   */
  protected async processWithRules(userInput: string): Promise<AgentResponse> {
    // Step 1：解析意图
    const parsed = this.parser.parse(userInput);

    // Step 2：构造 AgentCommand
    const command: AgentCommand = {
      id: crypto.randomUUID(),
      rawText: userInput,
      intent: parsed.intent,
      params: parsed.args,
      createdAt: new Date().toISOString(),
    };

    // Step 3：记录 pending action_log
    const log = await this.logService.logRequest(userInput, parsed.intent);

    // Step 4：意图未知
    if (parsed.intent === "unknown") {
      await this.logService.logFailure(log.id, "无法识别意图");
      return {
        message: this.composeBoundaryMessage(userInput, undefined, "unsupported_intent"),
        intent: parsed,
        actionLogId: log.id,
        metadata: {
          intent: "unknown",
          actionLogId: log.id,
          resultType: "failure",
          source: "chat",
        },
      };
    }

    // Step 5：查找对应 Tool
    const toolName = INTENT_TO_TOOL[parsed.intent];
    if (!toolName) {
      await this.logService.logFailure(log.id, `未映射的意图: ${parsed.intent}`);
      return {
        message: this.composeBoundaryMessage(userInput, undefined, "unsupported_intent"),
        intent: parsed,
        actionLogId: log.id,
        metadata: {
          intent: parsed.intent,
          actionLogId: log.id,
          resultType: "failure",
          source: "chat",
        },
      };
    }

    // Step 6：解析参数引用（"这个任务" 等）
    const resolvedArgs = await this.resolveArgs(parsed);

    // Step 7：构造 AgentActionPlan
    const riskLevel: RiskLevel = CONFIRMATION_POLICY[parsed.intent] ?? "safe";
    const needsConfirmation =
      riskLevel === "destructive" ||
      this.router.hasToolRequiringConfirmation(toolName);

    const plan: AgentActionPlan = {
      id: crypto.randomUUID(),
      commandId: command.id,
      intent: parsed.intent,
      toolName,
      params: resolvedArgs,
      requiresConfirmation: needsConfirmation,
      riskLevel,
      summary: this.buildConfirmDescription(parsed),
      createdAt: new Date().toISOString(),
    };

    // Step 8：需要确认 → 创建 confirmation 记录，挂起执行
    if (plan.requiresConfirmation) {
      const confirmation = await this.confirmService.createConfirmation({
        action_type: parsed.intent,
        tool_name: toolName,
        tool_args_json: JSON.stringify(resolvedArgs),
        description: plan.summary,
        risk_level: toLegacyRiskLevel(riskLevel),
      });

      await this.logService.logToolExecution(log.id, toolName, resolvedArgs);

      const metadata: ChatMessageMetadata = {
        intent: parsed.intent,
        toolName,
        actionLogId: log.id,
        confirmationId: confirmation.id,
        resultType: "pending_confirmation",
        source: "chat",
      };

      return {
        message: this.composeBoundaryMessage(userInput, undefined, "confirmation_required"),
        intent: parsed,
        confirmationId: confirmation.id,
        actionLogId: log.id,
        metadata,
      };
    }

    // Step 9：直接执行
    await this.logService.logToolExecution(log.id, toolName, resolvedArgs);
    const result = await this.router.execute(toolName, resolvedArgs);

    if (result.success) {
      await this.logService.logSuccess(log.id, result.data);
      this.trackLastEntities(toolName, result);
    } else {
      await this.logService.logFailure(log.id, result.error ?? result.message);
    }

    const metadata: ChatMessageMetadata = {
      intent: parsed.intent,
      toolName,
      actionLogId: log.id,
      relatedTaskId: result.relatedTaskId,
      relatedTimeBlockId: result.relatedTimeBlockId,
      resultType: result.success ? "success" : "failure",
      source: "chat",
    };

    return {
      message: this.composeBoundaryMessage(
        userInput,
        undefined,
        result.success ? "tool_success" : "tool_failure",
        [result]
      ),
      intent: parsed,
      toolResult: result,
      actionLogId: log.id,
      metadata,
    };
  }

  // ─── 通用工具执行（LLM 路径和规则路径共用） ─────────────────────────────────

  private async executeToolPlan(
    userInput: string,
    intent: IntentType,
    toolName: string,
    params: Record<string, unknown>,
    requiresConfirmation: boolean,
    riskLevel: RiskLevel,
    summary: string,
    extraMetadata: Partial<ChatMessageMetadata>
  ): Promise<AgentResponse> {
    const fakeParsedIntent: ParsedIntent = {
      intent,
      confidence: 1,
      args: params,
      rawInput: userInput,
    };

    const log = await this.logService.logRequest(userInput, intent);

    if (requiresConfirmation) {
      const confirmation = await this.confirmService.createConfirmation({
        action_type: intent,
        tool_name: toolName,
        tool_args_json: JSON.stringify(params),
        description: summary,
        risk_level: toLegacyRiskLevel(riskLevel),
      });

      await this.logService.logToolExecution(log.id, toolName, params);

      const metadata: ChatMessageMetadata = {
        intent,
        toolName,
        actionLogId: log.id,
        confirmationId: confirmation.id,
        resultType: "pending_confirmation",
        ...extraMetadata,
      };

      return {
        message: this.composeBoundaryMessage(userInput, undefined, "confirmation_required"),
        intent: fakeParsedIntent,
        confirmationId: confirmation.id,
        actionLogId: log.id,
        metadata,
      };
    }

    // 直接执行
    await this.logService.logToolExecution(log.id, toolName, params);
    const result = await this.router.execute(toolName, params);

    if (result.success) {
      await this.logService.logSuccess(log.id, result.data);
      this.trackLastEntities(toolName, result);
    } else {
      await this.logService.logFailure(log.id, result.error ?? result.message);
    }

    const metadata: ChatMessageMetadata = {
      intent,
      toolName,
      actionLogId: log.id,
      relatedTaskId: result.relatedTaskId,
      relatedTimeBlockId: result.relatedTimeBlockId,
      resultType: result.success ? "success" : "failure",
      ...extraMetadata,
    };

    return {
      message: this.composeBoundaryMessage(
        userInput,
        undefined,
        result.success ? "tool_success" : "tool_failure",
        [result]
      ),
      intent: fakeParsedIntent,
      toolResult: result,
      actionLogId: log.id,
      metadata,
    };
  }

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
    _plan: ExperienceActionPlan,
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

  private async resolveArgs(
    intent: ParsedIntent
  ): Promise<Record<string, unknown>> {
    const args = { ...intent.args };

    // 解析"这个任务" / "那个任务" → lastOperatedTaskId
    if (
      args.titleKeyword &&
      typeof args.titleKeyword === "string" &&
      (args.titleKeyword.includes("这个") ||
        args.titleKeyword.includes("那个") ||
        args.titleKeyword === "")
    ) {
      if (this.lastOperatedTaskId) {
        args.taskId = this.lastOperatedTaskId;
        delete args.titleKeyword;
        return args;
      }
    }

    // 通过 titleKeyword 搜索匹配任务
    if (
      args.titleKeyword &&
      typeof args.titleKeyword === "string" &&
      !args.taskId
    ) {
      const tasks = await this.taskService.getTasks({ excludeDeleted: true });
      const keyword = args.titleKeyword as string;
      const matched = tasks.find(
        (t) => t.title.includes(keyword) || keyword.includes(t.title)
      );
      if (matched) {
        args.taskId = matched.id;
      }
    }

    // schedule_task：将时间表达式解析为 ISO 时间字符串
    if (intent.intent === "schedule_task" && !args.start_time) {
      const { start_time, end_time } = this.resolveScheduleTime(args);
      args.start_time = start_time;
      args.end_time = end_time;
    }

    return args;
  }

  private resolveScheduleTime(args: Record<string, unknown>): {
    start_time: string;
    end_time: string;
  } {
    const dateStr = args.date as string | undefined;
    const timeOfDay = args.timeOfDay as string | undefined;
    const duration = (args.duration as number) ?? 60;

    const baseDate = dateStr ? new Date(dateStr) : new Date();

    let startHour = 9;
    let startMinute = 0;

    if (timeOfDay) {
      const [h, m] = timeOfDay.split(":").map(Number);
      startHour = h;
      startMinute = m;
    }

    const start = new Date(baseDate);
    start.setHours(startHour, startMinute, 0, 0);
    const end = new Date(start.getTime() + duration * 60 * 1000);

    return {
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    };
  }

  private trackLastEntities(_toolName: string, result: AgentToolResult): void {
    if (result.relatedTaskId) {
      this.lastOperatedTaskId = result.relatedTaskId;
    }
    if (result.relatedTimeBlockId) {
      this.lastOperatedTimeBlockId = result.relatedTimeBlockId;
    }

    // 兼容旧路径：从 data 对象中提取
    if (!result.relatedTaskId && result.data) {
      const data = result.data as Record<string, unknown>;
      if (data.id && typeof data.id === "string") {
        this.lastOperatedTaskId = data.id;
      } else if (data.task && typeof data.task === "object") {
        const task = data.task as Record<string, unknown>;
        if (task.id && typeof task.id === "string") {
          this.lastOperatedTaskId = task.id;
        }
      }
    }
  }

  private buildConfirmDescription(intent: ParsedIntent): string {
    switch (intent.intent) {
      case "delete_task":
        return `删除任务${intent.args.titleKeyword ? `「${intent.args.titleKeyword}」` : ""}（将同时删除关联时间块）`;
      case "delete_time_block":
        return "删除时间块";
      case "reschedule_day":
        return "重新排列今天的计划（未完成的时间块将被重新安排）";
      default:
        return intent.intent;
    }
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
