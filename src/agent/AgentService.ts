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
import { ConversationService } from "@/services/ConversationService";
import { TurnService } from "@/services/TurnService";
import { SemanticEventService } from "@/services/SemanticEventService";
import { ActiveContextService } from "@/services/ActiveContextService";
import { ScheduleService } from "@/services/ScheduleService";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";
import { ContextAssembler } from "@/agent/context/ContextAssembler";
import type { WorkingMemoryPacket } from "@/agent/context/WorkingMemoryPacket";
import { ContextTraceService } from "@/services/ContextTraceService";
import type { RecordStepInput } from "@/services/ContextTraceService";

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
  /**
   * V3.8: 当前存在的推荐类待确认提案快照。
   * chatStore 从 state.pendingProposal 取出并传入，
   * 供 DomainRoutingService Stage 2 PendingProposalInterpreter 使用。
   */
  pendingProposal?: import("@/agent/types").PendingProposalSnapshot;
  /** C1: 所属会话 ID（chatStore 传入；缺省时 AgentService fallback 到 ensureDefault） */
  conversationId?: string;
  /** C1: chatStore 预生成的用户消息 ID */
  userMessageId?: string;
  /** C1: chatStore 预生成的 assistant 消息 ID，用于 completeTurn 绑定 */
  assistantMessageId?: string;
}

interface ActionLogPort {
  logRequest(
    userInput: string,
    detectedIntent?: string,
    binding?: { conversation_id?: string; turn_id?: string; message_id?: string; confirmation_id?: string }
  ): Promise<{ id: string }>;
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
  /** C1: Turn 生命周期服务（不传则使用 SqliteTurnRepository） */
  turnService?: TurnService;
  /** C1: Conversation 服务（不传则使用 SqliteConversationRepository） */
  conversationService?: ConversationService;
  /** C2: 语义事件服务（不传则使用 SqliteSemanticEventRepository） */
  semanticEventService?: SemanticEventService;
  /** C3: ActiveContext 服务（不传则使用 SqliteActiveContextRepository） */
  activeContextService?: ActiveContextService;
  /** C6: trace step 服务（不传则不写入 trace step） */
  contextTraceService?: ContextTraceService;
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

// ─── C5: Sentinel Errors ──────────────────────────────────────────────────────

export class ConversationDeletedError extends Error {
  constructor(conversationId: string) {
    super(`会话已删除（id=${conversationId}），请新建会话再试`);
    this.name = "ConversationDeletedError";
  }
}

export class ConfirmationStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmationStaleError";
  }
}

// ─── AgentService ───────────────────────────────────────────────────────────

export class AgentService {
  private router: ToolRouter;
  private logService: ActionLogPort;
  private confirmService: ConfirmationService;
  private turnService: TurnService;
  private conversationService: ConversationService;
  private semanticEventService: SemanticEventService;
  private activeContextService: ActiveContextService;
  private taskService: TaskService;
  private timeBlockService: TimeBlockService;
  private scheduleService: ScheduleService;
  /** C4: 统一上下文组装器 */
  private contextAssembler: ContextAssembler;
  /** C6: trace step 服务（可选，null 时不写入） */
  private contextTraceService: ContextTraceService | null;

  // V3：LLM 相关组件
  private experienceContextBuilder: ConversationContextBuilder;
  private semanticFrameParser: SemanticFrameParser;
  private plannerPort: PlannerPort;
  private responseBoundary: ResponseBoundary;
  private domainRoutingService: DomainRoutingService;
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
    this.turnService = options.turnService ?? new TurnService();
    this.conversationService = options.conversationService ?? new ConversationService();
    this.semanticEventService = options.semanticEventService ?? new SemanticEventService();
    this.activeContextService = options.activeContextService ?? new ActiveContextService();
    this.taskService = options.taskService ?? new TaskService();
    this.timeBlockService = options.timeBlockService ?? new TimeBlockService();
    this.scheduleService = options.scheduleService ?? new ScheduleService();

    this.contextAssembler = new ContextAssembler(
      this.conversationService,
      this.confirmService,
      this.semanticEventService,
      this.activeContextService,
      this.taskService,
      this.timeBlockService
    );
    this.contextTraceService = options.contextTraceService ?? null;

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
          llmPlanner = new LLMExperiencePlanner(client, this.router);
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
    this.domainRoutingService = new DomainRoutingService(
      resolvedLLMClient,
      this.activeContextService,
      this.confirmService,
    );

    this.handlers = new Map<AgentDomain, AgentHandler>([
      ["general_chat", new LLMDirectHandler("general_chat", chatExecutor)],
      ["knowledge_qa", new LLMDirectHandler("knowledge_qa", chatExecutor)],
      ["writing_assistant", new LLMDirectHandler("writing_assistant", chatExecutor)],
      ["external_info", new ExternalInfoHandler()],
      ["assistant_meta", new MetaHandler()],
      ["feedback_or_complaint", new FeedbackHandler()],
      ["low_signal", new LowSignalHandler()],
    ]);

    this.registerTools();
  }

  // ─── C5: 入口防御层 ──────────────────────────────────────────────────────────

  /**
   * C5 §3.5: 断言会话仍然有效（deleted_at IS NULL）。
   * 已软删时抛 ConversationDeletedError，processInput 顶层 catch 组装 boundary 响应。
   */
  private async assertConversationAlive(conversationId: string): Promise<void> {
    try {
      const conv = await this.conversationService.getConversation(conversationId);
      if (conv?.deleted_at) {
        throw new ConversationDeletedError(conversationId);
      }
    } catch (e) {
      if (e instanceof ConversationDeletedError) throw e;
      // DB 不可用时降级不阻塞
    }
  }

  /**
   * C5 §3.5: 断言 confirmation 属于指定会话且会话未软删。
   * mismatch 或所在 conversation 已软删时抛 ConfirmationStaleError。
   */
  private async assertConfirmationBelongsToConversation(
    confirmationId: string,
    conversationId: string
  ): Promise<void> {
    try {
      const conf = await this.confirmService.getById(confirmationId);
      if (!conf) return; // 不存在的 confirmation 由下游校验处理
      if (conf.conversation_id && conf.conversation_id !== conversationId) {
        throw new ConfirmationStaleError(
          `confirmation ${confirmationId} 属于会话 ${conf.conversation_id}，不属于当前会话 ${conversationId}`
        );
      }
      if (conf.conversation_id) {
        const conv = await this.conversationService.getConversation(conf.conversation_id);
        if (conv?.deleted_at) {
          throw new ConfirmationStaleError(
            `confirmation ${confirmationId} 所属会话已删除，无法执行`
          );
        }
      }
    } catch (e) {
      if (e instanceof ConfirmationStaleError) throw e;
      // DB 不可用时降级不阻塞
    }
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
  }

  // ─── 主入口：处理用户输入（V3.5 LLM-first，无 fallback） ───────────────────

  // ─── C2: SemanticEvent 聚合写入 ─────────────────────────────────────────

  /**
   * 在 turn 完成/失败后写入一条 SemanticEvent（聚合写入策略）。
   * 失败只 warn，不影响主流程返回。
   */
  /** C3: 取 confirmation.expires_at，用于 active context 过期时间。失败时返回 undefined。 */
  private async _getConfirmationExpiresAt(confirmationId: string): Promise<string | undefined> {
    try {
      const conf = await this.confirmService.getById(confirmationId);
      return conf?.expires_at ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async recordTurnEvents(input: {
    conversationId: string;
    turnId?: string;
    messageId?: string;
    trigger: "user_message" | "confirm_action" | "reject_action" | "refine_action";
    response?: AgentResponse;
    errorMessage?: string;
    relatedConfirmationId?: string;
    relatedProposalId?: string;
  }): Promise<void> {
    try {
      const {
        conversationId, turnId, messageId, trigger,
        response, errorMessage, relatedConfirmationId, relatedProposalId,
      } = input;

      // ── 1. 推断 context_role ──────────────────────────────────────────────
      let context_role: import("@/types/agent.types").SemanticEventContextRole;
      if (trigger === "confirm_action") context_role = "confirmation_reply";
      else if (trigger === "reject_action") context_role = "rejection_reply";
      else if (trigger === "refine_action") context_role = "modification";
      else if (errorMessage) context_role = "new_intent";
      else {
        const routerSource = response?.metadata?.agentTrace?.routerSource;
        context_role = routerSource === "contextual" ? "continuation" : "new_intent";
      }

      // ── 2. 推断 intent ────────────────────────────────────────────────────
      let intent: import("@/types/agent.types").SemanticEventIntent;
      if (trigger === "confirm_action") intent = "confirm_action";
      else if (trigger === "reject_action") intent = "reject_action";
      else if (trigger === "refine_action") intent = "refine_action";
      else if (errorMessage) intent = "error";
      else {
        const userGoal = response?.metadata?.agentTrace?.semanticFrame?.userGoal;
        const domain = response?.metadata?.agentTrace?.domain;
        if (userGoal === "create_and_schedule_task" || userGoal === "create_reminder")
          intent = "create_task";
        else if (userGoal === "query_schedule" || userGoal === "query_schedule_range")
          intent = "query_schedule";
        else if (userGoal === "delete_task" || userGoal === "batch_delete_tasks")
          intent = "delete_task";
        else if (userGoal === "batch_reschedule_day") intent = "reschedule";
        else if (userGoal === "defer_task") intent = "reschedule";
        else if (domain === "time_management") intent = "schedule_task";
        else if (domain === "general_chat" || userGoal === "general_chat") intent = "casual_chat";
        else intent = "ask_question";
      }

      // ── 3. 推断 domain ────────────────────────────────────────────────────
      const traceDomain = response?.metadata?.agentTrace?.domain ?? response?.metadata?.intent as string | undefined;
      let domain: import("@/types/agent.types").SemanticEventDomain;
      if (trigger === "confirm_action" || trigger === "reject_action" || trigger === "refine_action") {
        domain = "time_management";
      } else if (traceDomain === "time_management") domain = "time_management";
      else if (traceDomain === "general_chat") domain = "general_chat";
      else if (traceDomain === "knowledge_qa") domain = "knowledge_qa";
      else if (traceDomain === "writing_assistant") domain = "writing_assistant";
      else if (traceDomain === "assistant_meta") domain = "assistant_meta";
      else if (traceDomain === "feedback") domain = "feedback";
      else if (traceDomain === "low_signal") domain = "low_signal";
      else domain = "unknown";

      // ── 4. 推断 source ────────────────────────────────────────────────────
      const routerSource = response?.metadata?.agentTrace?.routerSource;
      let source: import("@/types/agent.types").SemanticEventSource;
      if (trigger === "confirm_action" || trigger === "reject_action" || trigger === "refine_action")
        source = "tool";
      else if (routerSource === "llm") source = "llm";
      else source = "rule";

      // ── 5. 推断 confidence ────────────────────────────────────────────────
      const confidence =
        response?.metadata?.agentTrace?.llmDecision?.confidence ??
        response?.metadata?.confidence ??
        0.5;

      await this.semanticEventService.recordEvent({
        conversation_id: conversationId,
        turn_id: turnId,
        message_id: messageId,
        domain,
        intent,
        context_role,
        confidence,
        related_task_id: response?.toolResult?.relatedTaskId ?? response?.metadata?.relatedTaskId,
        related_time_block_id: response?.toolResult?.relatedTimeBlockId ?? response?.metadata?.relatedTimeBlockId,
        related_confirmation_id: relatedConfirmationId,
        related_proposal_id: relatedProposalId,
        source,
      });
    } catch (err) {
      console.warn("[AgentService] recordTurnEvents failed:", err);
    }
  }

  // ─── C6: Trace Step 聚合写入 ─────────────────────────────────────────────

  /**
   * C6: 批量写入 trace step（turn 结束前调用一次）。
   * 失败只 warn，不影响主流程返回。
   */
  private async recordTraceSteps(
    steps: RecordStepInput[],
  ): Promise<void> {
    if (!this.contextTraceService || steps.length === 0) return;
    try {
      await this.contextTraceService.recordSteps(steps);
    } catch (err) {
      console.warn("[AgentService] recordTraceSteps failed:", err);
    }
  }

  async processInput(
    userInput: string,
    context?: ProcessInputContext
  ): Promise<AgentResponse> {
    // C1: 获取/确保 conversationId，启动 Turn
    let conversationId = context?.conversationId;
    if (!conversationId) {
      try {
        const conv = await this.conversationService.ensureDefaultConversation();
        conversationId = conv.id;
      } catch {
        // DB 不可用（测试环境）时降级，不影响主流程
      }
    }

    // C5: 防御层 — 已软删会话不处理
    if (conversationId) {
      try {
        await this.assertConversationAlive(conversationId);
      } catch (e) {
        if (e instanceof ConversationDeletedError) {
          return {
            message: "该会话已删除，请新建会话再继续对话。",
            intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
            metadata: { resultType: "failure", source: "llm" },
          };
        }
      }
    }

    let turn: import("@/types/agent.types").Turn | undefined;
    try {
      if (conversationId) {
        turn = await this.turnService.startTurn({
          conversationId,
          userMessageId: context?.userMessageId,
          trigger: "user_message",
        });
      }
    } catch {
      // Turn 启动失败时不中断主流程
    }

    // C2: 确保始终有 userMessageId（chatStore 通常预生成；直接测试调用时此处兜底）
    const effectiveUserMessageId = context?.userMessageId ?? crypto.randomUUID();

    try {
      const response = await this._processInputInner(userInput, context, {
        conversationId,
        turnId: turn?.id,
        messageId: effectiveUserMessageId,
      });
      // C2: 写入 SemanticEvent（在 completeTurn 前）
      if (conversationId) {
        // 检测是否为细化推荐路径（user 有 pendingProposal 且 response 产出新 proposal）
        const wasRefine =
          !!context?.pendingProposal && !!response.metadata?.pendingProposal;
        const trigger = wasRefine ? "refine_action" : "user_message";
        const relatedProposalId = wasRefine
          ? (response.confirmationId ?? undefined)
          : undefined;
        await this.recordTurnEvents({
          conversationId,
          turnId: turn?.id,
          messageId: effectiveUserMessageId,
          trigger,
          response,
          relatedProposalId,
        });

        // C3: 写入 ActiveContext（与 recordTurnEvents 同样宽容策略）
        try {
          if (response.confirmationId) {
            const confirmedExpiresAt = await this._getConfirmationExpiresAt(
              response.confirmationId,
            );
            const snapshot = response.metadata?.pendingProposal;
            if (snapshot) {
              // recommendation 类：写 proposal snapshot
              const proposalId =
                snapshot.proposalId ?? (snapshot.proposalId = crypto.randomUUID());
              if (wasRefine && context?.pendingProposal?.confirmationId) {
                // refine 路径：replaceForRefine 已在 refineRecommendation 内写；跳过
              } else {
                await this.activeContextService.createForProposal({
                  conversation_id: conversationId,
                  confirmation_id: response.confirmationId,
                  proposal_id: proposalId,
                  proposal_snapshot: snapshot,
                  turn_id: turn?.id,
                  expires_at: confirmedExpiresAt,
                });
              }
            } else {
              // destructive confirmation
              await this.activeContextService.createForConfirmation({
                conversation_id: conversationId,
                confirmation_id: response.confirmationId,
                turn_id: turn?.id,
                expires_at: confirmedExpiresAt,
              });
            }
          }
        } catch (e) {
          console.warn("[AgentService] C3 active context write failed:", e);
        }
      }
      // C1: completeTurn
      if (turn) {
        try {
          await this.turnService.completeTurn(turn.id, context?.assistantMessageId ?? "pending");
        } catch { /* ignore */ }
      }
      return {
        ...response,
        metadata: {
          ...response.metadata,
          conversationId,
          turnId: turn?.id,
        },
      };
    } catch (e) {
      // C2: 写入 error event
      if (conversationId) {
        await this.recordTurnEvents({
          conversationId,
          turnId: turn?.id,
          messageId: effectiveUserMessageId,
          trigger: "user_message",
          errorMessage: String(e),
        });
      }
      if (turn) {
        try { await this.turnService.failTurn(turn.id, String(e)); } catch { /* ignore */ }
      }
      throw e;
    }
  }

  private async _processInputInner(
    userInput: string,
    context: ProcessInputContext | undefined,
    turnCtx: { conversationId?: string; turnId?: string; messageId?: string } | null
  ): Promise<AgentResponse> {
    // C6: 本 turn 内累积的 trace step（除 execute 外聚合写入）
    const pendingSteps: RecordStepInput[] = [];
    let stepOrder = 0;
    const conversationId = turnCtx?.conversationId ?? context?.conversationId;
    const turnId = turnCtx?.turnId;
    const messageId = turnCtx?.messageId ?? context?.userMessageId;

    const mkStep = (
      step_type: string,
      input_snapshot?: Record<string, unknown>,
      output_snapshot?: Record<string, unknown>,
      extra?: { latency_ms?: number; error?: string }
    ): RecordStepInput | null => {
      if (!conversationId || !turnId) return null;
      return {
        turn_id: turnId,
        conversation_id: conversationId,
        message_id: messageId,
        step_type,
        step_order: stepOrder++,
        input_snapshot,
        output_snapshot,
        ...extra,
      };
    };

    // C4: 在 startTurn 之后、classify 之前，组装一次 WorkingMemoryPacket。
    // 同一 turn 内复用，失败时 packet 退化为最小值，不阻塞主流程。
    let workingMemoryPacket: WorkingMemoryPacket | undefined;
    try {
      workingMemoryPacket = await this.contextAssembler.assemble({
        userInput,
        conversationId,
        turnId,
        pendingConfirmationId: context?.pendingConfirmationId,
      });

      // C6 §snapshot-migration: context_assemble step（取代 C4 workingMemorySnapshot 全文写 metadata）
      const snapshot = workingMemoryPacket ? ContextAssembler.toSnapshot(workingMemoryPacket) : undefined;
      const assembleStep = mkStep(
        "context_assemble",
        { userInput, pendingConfirmationId: context?.pendingConfirmationId ?? null },
        snapshot ? { slotSummaries: snapshot.slotSummaries, assembledAt: snapshot.assembledAt } : undefined,
      );
      if (assembleStep) pendingSteps.push(assembleStep);
    } catch {
      // assemble 整体不应抛错，这里是双重保险
    }

    const baseContext = this.timeManagementAgent.buildContext(
      context,
      this.getConversationMemorySnapshot()
    );
    const experienceContext = {
      ...baseContext,
      conversationId,
      turnId,
      messageId,
    };
    const route = await this.domainRoutingService.classify(userInput, {
      pendingConfirmationId: context?.pendingConfirmationId,
      pendingClarification: context?.pendingClarification,
      pendingProposal: context?.pendingProposal,
      currentDatetime: experienceContext.currentDatetime,
      lastAssistantText: (() => {
        const assistantMsgs = context?.recentMessages?.filter((m) => m.role === "assistant") ?? [];
        return assistantMsgs[assistantMsgs.length - 1]?.content;
      })(),
      timezone: context?.timezone,
      // C3: 透传 conversationId 给 Stage 0 ActiveContextResolver
      conversationId,
    }, workingMemoryPacket);

    // C6: context_resolve step（基于 DomainRoutingService 内部 Stage 0 出口信息）
    {
      const resolveStep = mkStep(
        "context_resolve",
        { rawInput: userInput, pendingConfirmationId: context?.pendingConfirmationId ?? null },
        {
          routerSource: route.routerSource ?? "fallback",
          hasPendingAction: !!route.pendingAction,
          pendingActionKind: route.pendingAction?.kind ?? null,
        },
      );
      if (resolveStep) pendingSteps.push(resolveStep);
    }

    // C6: route step（DomainRoutingService.classify 出口）
    {
      const routeStep = mkStep(
        "route",
        { rawInput: userInput },
        {
          domain: route.domain,
          routerSource: route.routerSource ?? "fallback",
          confidence: route.confidence,
          reason: route.llmDecision?.reason ?? route.fallbackReason ?? null,
        },
      );
      if (routeStep) pendingSteps.push(routeStep);
    }

    // V3.7 P1 / V3.8: 路由器检测到 pending confirmation 快捷回复或细化指令
    // 注意：这里调用内部方法，避免双重 Turn 创建
    if (route.pendingAction) {
      const { kind, confirmationId, refinements } = route.pendingAction;
      await this.recordTraceSteps(pendingSteps);
      if (kind === "confirm") {
        return this._innerConfirmAction(confirmationId);
      } else if (kind === "reject") {
        return this._innerRejectAction(confirmationId);
      } else if (kind === "refine") {
        return this.refineRecommendation(confirmationId, refinements ?? {}, experienceContext);
      }
    }

    if (route.domain === "time_management") {
      const semanticFrame = this.timeManagementAgent.parse(userInput);

      // C6: parse step（SemanticFrameParser 出口）
      {
        const parseStep = mkStep(
          "parse",
          { rawInput: userInput },
          {
            userGoal: semanticFrame.userGoal,
            extractedTitle: semanticFrame.extractedTitle ?? null,
            durationMinutes: semanticFrame.durationExpressions[0]?.minutes ?? null,
            confidence: semanticFrame.confidence,
          },
        );
        if (parseStep) pendingSteps.push(parseStep);
      }

      const handled = await this.timeManagementAgent.handle({
        userInput,
        context: experienceContext,
        semanticFrame,
        packet: workingMemoryPacket,
      });

      // C6: plan step（CompositePlanner/LLMExperiencePlanner 出口）
      {
        const traceAP = handled.metadata.agentTrace?.actionPlan;
        const planStep = mkStep(
          "plan",
          { userGoal: semanticFrame.userGoal },
          {
            plannerSource: handled.metadata.agentTrace?.planner ?? "experience",
            planKind: traceAP?.kind ?? null,
            toolName: traceAP?.toolName ?? null,
            requiresConfirmation: traceAP?.requiresConfirmation ?? false,
            riskLevel: traceAP?.riskLevel ?? null,
          },
        );
        if (planStep) pendingSteps.push(planStep);
      }

      // C6: confirm_create step（若有 confirmationId）
      if (handled.response.confirmationId) {
        const confirmStep = mkStep(
          "confirm_create",
          { planKind: handled.metadata.agentTrace?.actionPlan?.kind ?? null },
          {
            confirmationId: handled.response.confirmationId,
            actionType: handled.metadata.agentTrace?.actionPlan?.kind ?? null,
            riskLevel: handled.metadata.agentTrace?.actionPlan?.riskLevel ?? null,
          },
        );
        if (confirmStep) pendingSteps.push(confirmStep);
      }

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

      await this.recordTraceSteps(pendingSteps);

      // C6 §snapshot-migration: workingMemorySnapshot 降级为 traceStepIds 引用
      const assembleStepIds = pendingSteps
        .filter((s) => s.step_type === "context_assemble")
        .map((_, i) => `${turnId ?? "unknown"}_assemble_${i}`);
      const updatedMetadata = {
        ...handled.metadata,
        agentTrace: handled.metadata.agentTrace
          ? {
              ...handled.metadata.agentTrace,
              traceId: turnId,
              workingMemorySnapshot: assembleStepIds.length
                ? { traceStepIds: assembleStepIds }
                : handled.metadata.agentTrace.workingMemorySnapshot,
            }
          : handled.metadata.agentTrace,
      };

      return {
        message: handled.response.message ?? "",
        intent: handled.intent,
        toolResult: handled.response.toolResults?.[0],
        refreshHints: handled.response.refreshHints,
        actionLogId: handled.metadata.actionLogId,
        confirmationId: handled.response.confirmationId,
        metadata: updatedMetadata,
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
      // C4: 透传 workingMemoryPacket 给 handler（LLMDirectHandler 使用）
      handlerResult = handler
        ? await handler.handle(userInput, experienceContext, workingMemoryPacket)
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
    // binding 在此路径无 conversationId（由 processInput 层持有），不透传

    await this.recordTraceSteps(pendingSteps);

    const trace: AgentTrace = {
      traceId: turnId,
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
      // C6 §snapshot-migration: workingMemorySnapshot 降级为 traceStepIds 引用
      workingMemorySnapshot: turnId
        ? { traceStepIds: [`${turnId}_assemble_0`] }
        : undefined,
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

  /** 内部版：无 Turn 管理，供 processInput 内部委托使用 */
  private async _innerConfirmAction(confirmationId: string): Promise<AgentResponse> {
    return this._confirmActionCore(confirmationId);
  }

  /** 内部版：无 Turn 管理，供 processInput 内部委托使用 */
  private async _innerRejectAction(confirmationId: string): Promise<AgentResponse> {
    return this._rejectActionCore(confirmationId);
  }

  async confirmAction(confirmationId: string, context?: { conversationId?: string; assistantMessageId?: string }): Promise<AgentResponse> {
    let turn: import("@/types/agent.types").Turn | undefined;
    const conversationId = context?.conversationId;

    // C5: 防御层 — 跨会话 confirmation 引用
    if (conversationId) {
      try {
        await this.assertConfirmationBelongsToConversation(confirmationId, conversationId);
      } catch (e) {
        if (e instanceof ConfirmationStaleError) {
          return {
            message: this.composeBoundaryMessage("", undefined, "confirmation_stale"),
            intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
          };
        }
      }
    }

    if (conversationId) {
      try {
        turn = await this.turnService.startTurn({ conversationId, trigger: "confirm_action" });
      } catch { /* ignore */ }
    }
    try {
      const response = await this._confirmActionCore(confirmationId);
      // C2: 写入 SemanticEvent
      if (conversationId) {
        await this.recordTurnEvents({
          conversationId,
          turnId: turn?.id,
          trigger: "confirm_action",
          response,
          relatedConfirmationId: confirmationId,
        });
      }
      // C3: resolveOnConfirm
      try {
        await this.activeContextService.resolveOnConfirm(confirmationId);
      } catch (e) {
        console.warn("[AgentService] C3 resolveOnConfirm failed:", e);
      }
      // C6: confirm_resolve + execute trace steps
      if (conversationId && turn?.id) {
        const steps: RecordStepInput[] = [
          {
            turn_id: turn.id,
            conversation_id: conversationId,
            step_type: "confirm_resolve",
            step_order: 0,
            input_snapshot: { confirmationId },
            output_snapshot: {
              success: response.toolResult?.success ?? false,
              toolName: response.metadata?.toolName ?? null,
            },
          },
          {
            turn_id: turn.id,
            conversation_id: conversationId,
            step_type: "execute",
            step_order: 1,
            input_snapshot: { toolName: response.metadata?.toolName ?? null, confirmationId },
            output_snapshot: {
              success: response.toolResult?.success ?? false,
              relatedTaskId: response.toolResult?.relatedTaskId ?? null,
              relatedTimeBlockId: response.toolResult?.relatedTimeBlockId ?? null,
            },
          },
        ];
        await this.recordTraceSteps(steps);
      }
      if (turn) {
        try { await this.turnService.completeTurn(turn.id, context?.assistantMessageId ?? "pending"); } catch { /* ignore */ }
      }
      return { ...response, metadata: { ...response.metadata, conversationId, turnId: turn?.id } };
    } catch (e) {
      if (conversationId) {
        await this.recordTurnEvents({
          conversationId,
          turnId: turn?.id,
          trigger: "confirm_action",
          errorMessage: String(e),
          relatedConfirmationId: confirmationId,
        });
      }
      if (turn) { try { await this.turnService.failTurn(turn.id, String(e)); } catch { /* ignore */ } }
      throw e;
    }
  }

  private async _confirmActionCore(confirmationId: string): Promise<AgentResponse> {
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
      confirmation.action_type,
      {
        conversation_id: confirmation.conversation_id,
        turn_id: confirmation.turn_id,
        message_id: confirmation.message_id,
        confirmation_id: confirmationId,
      }
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
      // V3.8+: 让确认成功后的 lastCreatedTaskId / lastScheduledTimeBlockIds
      // 同步更新，便于后续"更改为 X 分钟"等指代型语句找到刚确认的对象。
      if (result.relatedTaskId) {
        this.rememberMentionedTask(result.relatedTaskId);
        if (
          confirmation.tool_name === "schedule_task" ||
          confirmation.tool_name === "create_time_block"
        ) {
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

  // ─── V3.8: 细化推荐——合并 refinements 后重新出候选并替换 pending ──────────

  private async refineRecommendation(
    confirmationId: string,
    refinements: NonNullable<import("@/agent/types").RefinementDecision["refinements"]>,
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
    const prevCategory = prevArgs.category as string | undefined;

    const now = new Date(context.currentDatetime);

    // ── 合并 refinements ─────────────────────────────────────────────────────
    const newDuration = refinements.durationMinutes ?? prevDuration;

    // anchorTime: 绝对时间锚点，直接作为起点，跳过 planner
    if (refinements.anchorTime) {
      const anchorStart = new Date(refinements.anchorTime.iso);
      const anchorEnd = new Date(anchorStart.getTime() + newDuration * 60 * 1000);
      try { await this.confirmService.reject(confirmationId); } catch { /* ignore */ }

      const log = await this.logService.logRequest(`[细化推荐:锚点时间] ${prevTitle}`, "refine_recommendation");
      const newPending = await this.confirmService.createConfirmation({
        action_type: confirmation.action_type,
        tool_name: "schedule_task",
        tool_args_json: JSON.stringify({
          title: prevTitle,
          category: prevCategory,
          duration: newDuration,
          estimated_duration_minutes: newDuration,
          start_time: anchorStart.toISOString(),
          end_time: anchorEnd.toISOString(),
        }),
        risk_level: "low",
        description: `按指定时间安排「${prevTitle}」`,
      });
      await this.logService.logSuccess(log.id, { newConfirmationId: newPending.id });

      // C3: replaceForRefine（anchorTime path）
      const refineResponse = this.buildRefineResponse(prevTitle, newDuration, newPending.id, anchorStart.toISOString(), anchorEnd.toISOString(), context, prevCategory, log.id, confirmation.action_type);
      if (context.conversationId) {
        try {
          const newSnapshot = refineResponse.metadata?.pendingProposal;
          if (newSnapshot) {
            const newProposalId = newSnapshot.proposalId ?? (newSnapshot.proposalId = crypto.randomUUID());
            await this.activeContextService.replaceForRefine({
              old_confirmation_id: confirmationId,
              new_confirmation_id: newPending.id,
              new_proposal_id: newProposalId,
              new_proposal_snapshot: newSnapshot,
              conversation_id: context.conversationId,
              turn_id: context.turnId,
            });
          }
        } catch (e) {
          console.warn("[AgentService] C3 replaceForRefine (anchor) failed:", e);
        }
      }
      return refineResponse;
    }

    // 计算搜索起点（notBefore）
    let notBefore: Date = now;
    let dateOffset = 0;

    if (refinements.dateOffsetDays !== undefined && refinements.dateOffsetDays !== 0) {
      // 日期偏移：直接设 date，不限制 notBefore 的时间
      dateOffset = refinements.dateOffsetDays;
      notBefore = now; // 使用目标日期的窗口开始
    } else if (refinements.direction === "later") {
      notBefore = prevEnd ? new Date(Math.max(new Date(prevEnd).getTime(), now.getTime())) : now;
    } else if (refinements.direction === "earlier") {
      const prevStartMs = prevStart ? new Date(prevStart).getTime() : now.getTime();
      notBefore = new Date(Math.max(prevStartMs - newDuration * 60 * 1000, now.getTime()));
    }

    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + dateOffset);

    // 重新用 RecommendationPlanner 推荐
    const availabilityProvider = new AvailabilityProvider(this.timeBlockService);
    const reasoner = new SchedulingReasoner();
    const planner = new RecommendationPlanner(availabilityProvider, reasoner);

    const candidates = await planner.plan({
      date: targetDate,
      durationMinutes: newDuration,
      timezone: context.timezone,
      now: notBefore,
      bufferMinutes: refinements.direction || refinements.dateOffsetDays !== undefined ? 0 : undefined,
      timeOfDay: refinements.timeOfDay,
    });

    const log = await this.logService.logRequest(`[细化推荐] ${prevTitle}`, "refine_recommendation");

    try { await this.confirmService.reject(confirmationId); } catch { /* ignore */ }

    if (candidates.length > 0) {
      const rec = candidates[0];
      const newPending = await this.confirmService.createConfirmation({
        action_type: confirmation.action_type,
        tool_name: "schedule_task",
        tool_args_json: JSON.stringify({
          title: prevTitle,
          category: prevCategory,
          duration: newDuration,
          estimated_duration_minutes: newDuration,
          start_time: rec.start,
          end_time: rec.end,
        }),
        risk_level: "low",
        description: `按调整后时间安排「${prevTitle}」`,
      });
      await this.logService.logSuccess(log.id, { newConfirmationId: newPending.id, recommendation: rec });

      // C3: replaceForRefine（planner path）
      const refineResponseMain = this.buildRefineResponse(prevTitle, newDuration, newPending.id, rec.start, rec.end, context, prevCategory, log.id, confirmation.action_type);
      if (context.conversationId) {
        try {
          const newSnapshotMain = refineResponseMain.metadata?.pendingProposal;
          if (newSnapshotMain) {
            const newProposalIdMain = newSnapshotMain.proposalId ?? (newSnapshotMain.proposalId = crypto.randomUUID());
            await this.activeContextService.replaceForRefine({
              old_confirmation_id: confirmationId,
              new_confirmation_id: newPending.id,
              new_proposal_id: newProposalIdMain,
              new_proposal_snapshot: newSnapshotMain,
              conversation_id: context.conversationId,
              turn_id: context.turnId,
            });
          }
        } catch (e) {
          console.warn("[AgentService] C3 replaceForRefine (planner) failed:", e);
        }
      }
      return refineResponseMain;
    }

    // 无可用时段
    await this.logService.logSuccess(log.id, { candidates: 0 });
    return {
      message: "没有找到合适的时间段，你可以换个时段或者手动选择具体时间。",
      intent: { intent: "unknown", confidence: 0.8, args: {}, rawInput: "" },
    };
  }

  private buildRefineResponse(
    title: string,
    duration: number,
    newConfirmationId: string,
    startIso: string,
    endIso: string,
    context: import("@/agent/types").AgentExperienceContext,
    category: string | undefined,
    actionLogId: string,
    actionType: string
  ): AgentResponse {
    const startStr = new Date(startIso).toLocaleTimeString("zh-CN", {
      hour: "2-digit", minute: "2-digit", timeZone: context.timezone, hour12: false,
    });
    const endStr = new Date(endIso).toLocaleTimeString("zh-CN", {
      hour: "2-digit", minute: "2-digit", timeZone: context.timezone, hour12: false,
    });
    const message = `那改到 ${startStr} - ${endStr} 怎么样，需要我按这个时间来安排吗？`;

    const pendingProposal: import("@/agent/types").PendingProposalSnapshot = {
      confirmationId: newConfirmationId,
      kind: "recommendation",
      title,
      duration,
      category,
      start: startIso,
      end: endIso,
    };

    const metadata: ChatMessageMetadata = {
      intent: actionType,
      confirmationId: newConfirmationId,
      actionLogId,
      resultType: "pending_confirmation",
      source: "llm",
      llmResponseType: "clarification",
      pendingProposal,
    };

    return {
      message,
      intent: { intent: "unknown", confidence: 0.95, args: {}, rawInput: "" },
      confirmationId: newConfirmationId,
      metadata,
    };
  }

  // ─── 拒绝执行（Phase 4：新建 cancelled action_log） ──────────────────────

  async rejectAction(confirmationId: string, context?: { conversationId?: string; assistantMessageId?: string }): Promise<AgentResponse> {
    let turn: import("@/types/agent.types").Turn | undefined;
    const conversationId = context?.conversationId;

    // C5: 防御层 — 跨会话 confirmation 引用
    if (conversationId) {
      try {
        await this.assertConfirmationBelongsToConversation(confirmationId, conversationId);
      } catch (e) {
        if (e instanceof ConfirmationStaleError) {
          return {
            message: this.composeBoundaryMessage("", undefined, "confirmation_stale"),
            intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
          };
        }
      }
    }

    if (conversationId) {
      try {
        turn = await this.turnService.startTurn({ conversationId, trigger: "reject_action" });
      } catch { /* ignore */ }
    }
    try {
      const response = await this._rejectActionCore(confirmationId);
      // C2: 写入 SemanticEvent
      if (conversationId) {
        await this.recordTurnEvents({
          conversationId,
          turnId: turn?.id,
          trigger: "reject_action",
          response,
          relatedConfirmationId: confirmationId,
        });
      }
      // C3: resolveOnReject
      try {
        await this.activeContextService.resolveOnReject(confirmationId);
      } catch (e) {
        console.warn("[AgentService] C3 resolveOnReject failed:", e);
      }
      // C6: reject trace step
      if (conversationId && turn?.id) {
        await this.recordTraceSteps([{
          turn_id: turn.id,
          conversation_id: conversationId,
          step_type: "reject",
          step_order: 0,
          input_snapshot: { confirmationId },
          output_snapshot: { reason: "user_rejected" },
        }]);
      }
      if (turn) {
        try { await this.turnService.completeTurn(turn.id, context?.assistantMessageId ?? "pending"); } catch { /* ignore */ }
      }
      return { ...response, metadata: { ...response.metadata, conversationId, turnId: turn?.id } };
    } catch (e) {
      if (conversationId) {
        await this.recordTurnEvents({
          conversationId,
          turnId: turn?.id,
          trigger: "reject_action",
          errorMessage: String(e),
          relatedConfirmationId: confirmationId,
        });
      }
      if (turn) { try { await this.turnService.failTurn(turn.id, String(e)); } catch { /* ignore */ } }
      throw e;
    }
  }

  private async _rejectActionCore(confirmationId: string): Promise<AgentResponse> {
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
      confirmation?.action_type,
      {
        conversation_id: confirmation?.conversation_id,
        turn_id: confirmation?.turn_id,
        message_id: confirmation?.message_id,
        confirmation_id: confirmationId,
      }
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
