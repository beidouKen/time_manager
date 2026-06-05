// ============================================================
// V2.5 — Agent Tool Contract 类型契约
//
// 设计原则：
// 1. IntentType 仅表示 Chat Agent 用户意图（snake_case，与 IntentParser、
//    INTENT_TO_TOOL、ToolRouter 注册名三处保持完全一致）
// 2. Heartbeat 触发的日志使用独立字符串（如 heartbeat_complete_block），
//    不进入 IntentType
// 3. AgentCommand → AgentActionPlan → AgentToolResult 三段式表达
//    用户输入到工具结果的完整链路
// ============================================================

/**
 * Chat Agent 支持的用户意图类型。
 * 命名约定：snake_case，与 IntentParser 规则、INTENT_TO_TOOL 映射、
 * ToolRouter 注册的 tool name 保持一致。
 */
export type IntentType =
  | "create_task"
  | "list_tasks"
  | "update_task"
  | "delete_task"
  | "mark_task_completed"
  | "create_time_block"
  | "move_time_block"
  | "delete_time_block"
  | "list_time_blocks"
  | "bind_task_to_time_block"
  | "schedule_task"
  | "reschedule_day"
  | "detect_conflicts"
  | "get_free_slots"
  | "get_today_plan"
  | "explain_task"
  | "explain_schedule"
  | "unknown";

/**
 * 操作风险等级。决定是否需要确认。
 * - safe: 查询类、可逆类操作，无需确认
 * - confirm: 普通修改，可能需要确认（视具体策略）
 * - destructive: 删除、批量重排等高危操作，必须确认
 */
export type RiskLevel = "safe" | "confirm" | "destructive";

/**
 * 兼容旧字段（DB schema 的 risk_level 仍为 low/medium/high）。
 * 仅用于 PendingConfirmation 持久化层；新代码请使用 RiskLevel。
 */
export type LegacyRiskLevel = "low" | "medium" | "high";

// ─── ParsedIntent（IntentParser 输出，保持向后兼容） ─────────────────────

export interface ParsedIntent {
  intent: IntentType;
  confidence: number;
  args: Record<string, unknown>;
  rawInput: string;
}

// ─── ToolResult（旧结构，各 Tool 仍返回此结构） ──────────────────────────

export interface ToolResult {
  success: boolean;
  data?: unknown;
  message: string;
  error?: string;
}

// ─── AgentToolResult（V2.5 统一结构，由 ToolRouter normalize 产出） ──────

/**
 * V2.5 统一工具结果结构。
 * ToolRouter.execute 会把每个 Tool 的 ToolResult normalize 成此结构，
 * 提取关联实体 ID 以便上层（AgentService、Chat metadata）使用。
 */
export interface AgentToolResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
  /** 关联的 Task ID（若 Tool 操作的是任务相关实体） */
  relatedTaskId?: string;
  /** 关联的 TimeBlock ID（若 Tool 操作的是时间块相关实体） */
  relatedTimeBlockId?: string;
  /** 是否需要确认（ToolRouter 在拦截确认时填充） */
  requiresConfirmation?: boolean;
  /** 若 requiresConfirmation=true，对应的 confirmation 记录 ID */
  confirmationId?: string;
}

// ─── V3.6.1 Agent Experience Pipeline Types ───────────────────────────────

export type AgentDomain =
  | "time_management"
  | "general_chat"
  | "knowledge_qa"
  | "writing_assistant"
  | "external_info"
  | "assistant_meta"
  | "feedback_or_complaint"
  | "low_signal";

// ─── V3.7 P1 DomainRoutingDecision（LLMDomainClassifier 输出契约） ───────────

export interface DomainRoutingDecision {
  domain: AgentDomain;
  /** 细分子类型，如 meta_model / meta_capabilities / meta_app_help */
  subtype?: string;
  /** 置信度 0..1 */
  confidence: number;
  /** true 表示此次分类需要写操作，只有 time_management 合法 */
  requiresWrite: boolean;
  /** 可读 trace 原因，用于 QA */
  reason: string;
}

export interface AgentRouteResult {
  domain: AgentDomain;
  confidence: number;
  matchedRule?: string;
  rawInput: string;
  /** V3.7 P1: 路由来源 */
  routerSource?: "contextual" | "llm" | "fallback";
  /** V3.7 P1: LLM 分类决策（routerSource=llm 时存在） */
  llmDecision?: DomainRoutingDecision;
  /** V3.7 P1: fallback 原因（routerSource=fallback 时存在） */
  fallbackReason?: string;
  /** V3.7 P1: LLM 决策子类型（assistant_meta 细分等） */
  subtype?: string;
  /**
   * V3.7 P1 / V3.8: ContextualPreRouter 或 PendingProposalInterpreter 检测到
   * pending confirmation 回复时填充。
   * - confirm/reject: AgentService.processInput 直接转发
   * - refine: 携带 refinements，由 refineRecommendation 合并参数后重新推荐
   */
  pendingAction?: {
    kind: "confirm" | "reject" | "refine";
    confirmationId: string;
    refinements?: RefinementDecision["refinements"];
  };
}

// ─── V3.8 Pending Proposal（推荐类待确认提案快照） ──────────────────────────

/**
 * 推荐类待确认提案的结构化快照。
 * 由 TimeManagementAgent 在 request_recommendation 成功后写入 metadata，
 * chatStore 缓存在内存中，供下一轮用户输入时作为路由器上下文。
 */
export interface PendingProposalSnapshot {
  confirmationId: string;
  kind: "recommendation";
  title: string;
  /**
   * C3: 提案自身的 UUID，由 TimeManagementAgent 在 request_recommendation 时生成。
   * 用于 ActiveContext.active_proposal_id，以及跨话题 / 刷新后从 DB 还原 pendingProposal 的关联键。
   */
  proposalId?: string;
  /** 时长（分钟） */
  duration: number;
  category?: string;
  /** 推荐开始时间 ISO */
  start: string;
  /** 推荐结束时间 ISO */
  end: string;
  /** 时段标签（如"下午"），供解释器上下文使用 */
  timeOfDayLabel?: string;
}

/**
 * PendingProposalInterpreter 输出的结构化决策。
 * - confirm/reject: 直接转发
 * - refine: 携带细化参数，由 refineRecommendation 合并
 * - topic_change: 用户已切换话题，路由器继续走 LLMDomainClassifier
 */
export interface RefinementDecision {
  intent: "confirm" | "reject" | "refine" | "topic_change";
  confidence: number;
  refinements?: {
    /** 覆盖时长 */
    durationMinutes?: number;
    /** 覆盖时段约束（如"下午"） */
    timeOfDay?: import("@/agent/experience/SemanticFrameParser").TimeOfDayRange;
    /** 方向调整（不改时长，只移动时间窗口） */
    direction?: "later" | "earlier";
    /** 绝对时间锚点（直接以此时间安排，跳过 planner） */
    anchorTime?: { iso: string; sourceText: string };
    /** 日期偏移（0=今天，1=明天，-1=昨天） */
    dateOffsetDays?: number;
    /** 细化类型：仅改时长时继承原 proposal 锚点 */
    kind?: "duration_only" | "time_shift" | "date_shift" | "anchor";
  };
}

export interface AgentHandlerResult {
  domain: AgentDomain;
  message?: string;
  responseKind?: string;
  toolResults?: AgentToolResult[];
  queryBlocks?: import("@/types/timeblock.types").TimeBlock[];
  refreshHints?: AgentRefreshHints;
  metadata?: Partial<ChatMessageMetadata>;
  trace?: Partial<AgentTrace>;
}

export type SemanticUserGoal =
  | "ask_current_time"
  | "create_and_schedule_task"
  | "create_reminder"
  | "delete_task"
  | "query_schedule"
  | "general_chat"
  | "unsupported_intent"
  // V4+: 多日 / 批量 / 延期
  | "query_schedule_range"
  | "batch_delete_tasks"
  | "batch_reschedule_day"
  | "defer_task"
  // V3.8+: 在没有重新提及任务名的情况下，修改最近一次创建/安排的时间块时长
  | "update_recent_duration"
  // V4.1+: 查询任务列表 / 请求时间管理建议（区别于创建/安排意图）
  | "query_tasks"
  | "request_advice";

export interface SemanticFrame {
  userGoal: SemanticUserGoal;
  objectReferences: Array<{
    type: "task" | "time_block" | "recent" | "unknown";
    sourceText: string;
    keyword?: string;
  }>;
  timeExpressions: Array<{
    sourceText: string;
    normalized?: "start_now" | "absolute" | string;
    /** ISO 8601 string, present when normalized === "absolute" */
    iso?: string;
  }>;
  durationExpressions: Array<{
    sourceText: string;
    minutes: number;
  }>;
  constraints: Record<string, unknown>;
  userTone?: string;
  urgency?: "low" | "normal" | "high";
  missingInfo: string[];
  confidence: number;
  extractedTitle?: string;
  category?: string;
  /**
   * V4+: 多日日期范围，用于 query_schedule_range / batch_delete_tasks 等目标。
   * from/to 为 "YYYY-MM-DD" 格式（本地日期）。
   */
  dateRange?: {
    from: string;
    to: string;
    sourceText: string;
  };
  // ─── V3.8+ Past Time Disambiguation ────────────────────────────────────────
  /**
   * 用户是否明确提到了"今天/今晚/今早"等今日日期词。
   * 为 true 时，时段约束不得被静默顺延到明天；应追问用户意图。
   */
  isExplicitToday?: boolean;
  /**
   * 用户明确给出的日期锚点。
   * - 'today'        → 今天（今天/今晚/今早）
   * - 'tomorrow'     → 明天
   * - 'specific_date'→ 后天/具体日期
   * - null           → 未明确指定日期（只有时段词，如"早上/下午"）
   */
  explicitDateAnchor?: "today" | "tomorrow" | "specific_date" | null;
  /**
   * 是否包含补记/记录语义（补上/补记/刚才/已经/之前做了 等）。
   * 为 true 时，即使时段已过，也应允许按历史时间创建记录，不做顺延或追问。
   */
  possibleBackfill?: boolean;
  /**
   * 用户是否明确要求"下一个/最近一个/之后"等未来时段（非系统默认顺延）。
   * 为 true 且无明确今天/明天时，允许 allowShiftToNextDay。
   */
  requestsNextOccurrence?: boolean;
}

export interface AgentExperienceContext {
  currentDatetime: string;
  timezone: string;
  currentTimelineDate?: string;
  selectedDate?: string;
  currentScreen?: string;
  recentMessages: Array<{ role: string; content: string }>;
  lastCreatedTaskId: string | null;
  lastMentionedTaskIds: string[];
  lastScheduledTimeBlockIds: string[];
  lastToolResults: AgentToolResult[];
  /** C2/G11: 会话 ID（供 TimeManagementAgent 透传给 createConfirmation / logRequest） */
  conversationId?: string;
  /** C2/G11: 回合 ID（供 TimeManagementAgent 透传） */
  turnId?: string;
  /** C2/G11: 用户消息 ID（供 TimeManagementAgent 透传） */
  messageId?: string;
}

export interface AgentRefreshHints {
  tasks?: boolean;
  timeline?: boolean;
  timelineDate?: string;
}

export interface ExperienceActionPlan {
  id: string;
  kind:
    | "direct_response"
    | "tool"
    | "query_schedule"
    | "query_tasks"
    | "chat"
    | "request_recommendation"
    | "suggestion"
    | "defer_task"
    | "batch_action";
  userGoal: SemanticUserGoal;
  toolName?: string;
  params: Record<string, unknown>;
  requiresConfirmation: boolean;
  riskLevel: RiskLevel;
  summary: string;
  refreshHints?: AgentRefreshHints;
  createdAt: string;
  /**
   * V3.7: batch_action / defer_task 确认执行前预先分解的原子操作列表。
   * confirmAction() 检测到此字段后按序执行，而非尝试调用未注册的 Tool。
   */
  actions?: SinglePlanAction[];
  /**
   * V3+: 人类可读的 trace 标签，例如 "create_and_schedule_task:exact"。
   * 用于可追溯性和回放测试。
   */
  traceLabel?: string;
  /**
   * V3+: 回放键（确定性内容 hash，排除 id/createdAt），
   * 相同输入 + 相同时间应产生相同 replayKey。
   */
  replayKey?: string;
}

// ─── ToolDefinition（保持向后兼容，所有 17 个 Tool 实现此接口） ─────────

export interface ToolDefinition {
  name: string;
  description: string;
  requiresConfirmation: boolean;
  riskLevel: LegacyRiskLevel;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

// ─── AgentCommand（用户输入解析后的结构化命令） ──────────────────────────

/**
 * 用户输入被 IntentParser 解析后的结构化命令表示。
 * 是 AgentService 内部从输入到执行的第一阶段产物。
 */
export interface AgentCommand {
  id: string;
  rawText: string;
  intent: IntentType;
  params: Record<string, unknown>;
  createdAt: string;
}

// ─── AgentActionPlan（Agent 准备执行的动作计划） ─────────────────────────

/**
 * AgentService 基于 AgentCommand 构造的动作计划。
 * 包含执行所需的全部信息：要调用的 Tool、最终参数、是否需要确认、风险等级、人类可读摘要。
 * 这是 V3 接入 LLM 时进一步展开成多步计划的雏形。
 */
export interface AgentActionPlan {
  id: string;
  commandId: string;
  intent: IntentType;
  toolName: string;
  params: Record<string, unknown>;
  requiresConfirmation: boolean;
  riskLevel: RiskLevel;
  summary: string;
  createdAt: string;
}

// ─── ConfirmationPolicy（明确每个 intent 是否需要确认） ──────────────────

/**
 * 确认策略：明确每个 intent 是否需要用户确认及其风险等级。
 *
 * - "safe"        → 不需要确认（查询、低危创建、标记完成、Heartbeat 反馈）
 * - "confirm"     → 一般情况不确认，但有冲突时由 Tool 自身返回 requiresConfirmation
 * - "destructive" → 必须确认（删除、批量重排）
 *
 * 注意：本表是 V2.5 的"声明式策略"，AgentService 根据它判断是否走确认流程。
 * 若 Tool 自身 requiresConfirmation=true（如 DeleteTaskTool），也走确认流程，
 * 两者取并集。
 */
export const CONFIRMATION_POLICY: Record<IntentType, RiskLevel> = {
  // 查询类：无害
  list_tasks: "safe",
  list_time_blocks: "safe",
  get_today_plan: "safe",
  get_free_slots: "safe",
  detect_conflicts: "safe",
  explain_task: "safe",
  explain_schedule: "safe",

  // 创建类：低风险
  create_task: "safe",
  create_time_block: "confirm",
  bind_task_to_time_block: "safe",
  schedule_task: "safe",

  // 修改类：低风险
  update_task: "safe",
  move_time_block: "safe",
  mark_task_completed: "safe",

  // 删除/批量：高风险，必须确认
  delete_task: "destructive",
  delete_time_block: "destructive",
  reschedule_day: "destructive",

  // 兜底
  unknown: "safe",
};

/**
 * RiskLevel → DB schema 的 LegacyRiskLevel 的映射。
 * 仅用于持久化 PendingConfirmation 时的字段转换。
 */
export function toLegacyRiskLevel(level: RiskLevel): LegacyRiskLevel {
  switch (level) {
    case "safe":
      return "low";
    case "confirm":
      return "medium";
    case "destructive":
      return "high";
  }
}

// ─── ChatMessageMetadata（conversation_messages.metadata_json 的 schema） ──

/**
 * Chat 消息的 metadata 结构。
 * 序列化后存入 conversation_messages.metadata_json，
 * 用于 V2.5 起承载 Agent 操作的可追溯信息。
 *
 * 来源说明：
 * - "chat":      用户在 Chat 中触发（规则 IntentParser 路径）
 * - "heartbeat": Heartbeat UI 触发的反馈操作
 * - "system":    系统自动行为
 * - "llm":       V3 LLM Agent 路径（DeepSeek 解析）
 */
export interface ChatMessageMetadata {
  intent?: string;
  toolName?: string;
  actionLogId?: string;
  confirmationId?: string;
  relatedTaskId?: string;
  relatedTimeBlockId?: string;
  resultType?:
    | "success"
    | "failure"
    | "pending_confirmation"
    | "rejected"
    | "already_processed";
  /** 确认请求已被处理过（stale 路径） */
  alreadyProcessed?: boolean;
  source?: "chat" | "heartbeat" | "system" | "llm";
  // V3 新增：LLM 相关元数据
  /** LLM 使用的模型名称（如 deepseek-v4-pro） */
  llmModel?: string;
  /** LLM 解析置信度 0-1 */
  confidence?: number;
  /** LLM 返回的响应类型 */
  llmResponseType?: "tool_plan" | "clarification" | "chitchat" | "unsupported";
  // V3.5 新增
  /** Agent 执行追踪（LLM 路径写入，用于调试与 UI 展示） */
  agentTrace?: AgentTrace;
  /**
   * V3.8: request_recommendation 成功后写入，供 chatStore 缓存为 pendingProposal state，
   * 使下一轮对话能通过 PendingProposalInterpreter 做结构化细化。
   */
  pendingProposal?: PendingProposalSnapshot;
  /** C1: 所属会话 ID */
  conversationId?: string;
  /** C1: 所属回合 ID */
  turnId?: string;
  /** Past time 追问时可用的快捷操作（UI 后续渲染） */
  quickActions?: Array<
    "backfill_today" | "schedule_tomorrow" | "schedule_other_day" | "cancel"
  >;
}

// ─── V3.7 SinglePlanAction（batch/defer 分解后的原子操作） ──────────────────

/**
 * batch_action / defer_task 确认执行时，分解出的单个原子操作。
 * 结构与 PlanOption.actions[*] 对齐，共用 executeActionList 路径。
 */
export interface SinglePlanAction {
  toolName: string;
  params: Record<string, unknown>;
  summary?: string;
}

// ─── V3.5 AgentTrace ────────────────────────────────────────────────────────

/**
 * 记录单次 LLM Agent 执行的追踪信息，写入 ChatMessage metadata。
 * - mode: LLM 返回的响应类型，或 error 表示各类错误
 * - errorKind: 仅 mode=error 时填充，标识具体错误原因
 */
export interface AgentTrace {
  /**
   * C6: trace 聚合 key，等同于 turn_id（step 行通过 turn_id 关联到 AgentTrace）。
   * 不单独建 agent_traces 头表；头记录仍寄生在 conversation_messages.metadata_json。
   */
  traceId?: string;
  planner: "llm" | "experience" | "router";
  /** V3.7 P1: 三段式路由器来源（planner=router 时填充） */
  routerSource?: "contextual" | "llm" | "fallback";
  /** V3.7 P1: LLM 分类决策（routerSource=llm 时填充） */
  llmDecision?: DomainRoutingDecision;
  /** V3.7 P1: fallback 原因（routerSource=fallback 时填充） */
  routerFallbackReason?: string;
  mode:
    | "tool_plan"
    | "clarification"
    | "chitchat"
    | "unsupported"
    | "error"
    | "direct_response"
    | "query_schedule"
    | "suggestion";
  domain?: AgentDomain;
  model?: string;
  toolName?: string;
  errorKind?:
    | "disabled"
    | "api_key_missing"
    | "network_error"
    | "http_error"
    | "parse_error"
    | "fallback"
    | "invalid_tool"
    | "policy_upgraded";
  rawInput?: string;
  contextSnapshot?: AgentExperienceContext;
  semanticFrame?: SemanticFrame;
  actionPlan?: ExperienceActionPlan;
  toolResults?: AgentToolResult[];
  finalResponse?: string;
  /**
   * V3+: 人类可读的计划摘要，例如 "安排写文档任务（30分钟，推荐时间）"。
   */
  planSummary?: string;
  /**
   * V3+: 确认链路元数据（当操作进入 confirmation_required 时填充）。
   */
  confirmationMetadata?: {
    confirmationId: string;
    riskLevel: RiskLevel;
    toolName: string;
  };
  /**
   * V5+: 建议类响应的分类。
   */
  suggestionKind?: "suggestion" | "confirmation_required" | "executable_action";
  /**
   * C4: working memory 摘要（历史格式，C6 前含完整 slotSummaries）。
   * C6: 语义降级为 { traceStepIds: string[] }（step 行包含完整摘要；metadata 仅保引用）。
   * 向后兼容：读取时检查 traceStepIds 是否存在；无则回退到旧 slotSummaries 格式。
   */
  workingMemorySnapshot?:
    | import("@/agent/context/WorkingMemoryPacket").WorkingMemorySnapshot
    | { traceStepIds: string[] };
}

// ─── C6 AgentTraceStep ───────────────────────────────────────────────────────

/**
 * C6: Agent 内部决策阶段类型（开放枚举，DB 不加 CHECK）。
 * 初始覆盖 10 个阶段；后续新增阶段无需 migration。
 */
export type AgentTraceStepType =
  | "context_resolve"   // Stage 0 ActiveContextResolver 出口
  | "context_assemble"  // ContextAssembler.assemble 出口（C4 packet 摘要迁此）
  | "route"             // DomainRoutingService.classify 出口
  | "parse"             // SemanticFrameParser 出口（time_management 路径）
  | "plan"              // LLMExperiencePlanner / CompositePlanner 出口
  | "execute"           // ToolRouter.execute 后（强制 latency_ms）
  | "confirm_create"    // ConfirmationService.createConfirmation 后
  | "confirm_resolve"   // confirmAction 成功后
  | "reject"            // rejectAction 后
  | "refine"            // refineRecommendation 后
  | string;             // 允许扩展

/**
 * C6: Agent 单次 turn 内某个阶段的决策快照（行级审计事件）。
 * append-only，写入后不可修改或删除。
 */
export interface AgentTraceStep {
  id: string;
  turn_id: string;
  conversation_id: string;
  message_id?: string;
  step_type: AgentTraceStepType;
  /** turn 内按写入顺序的序号，用于稳定时间线展示 */
  step_order: number;
  /** 阶段入参关键字段（不存全 packet，仅记关键字段） */
  input_snapshot_json?: string;
  /** 阶段输出关键字段 */
  output_snapshot_json?: string;
  /** 执行延迟（仅 execute step 强制填充，其他可选） */
  latency_ms?: number;
  /** step 内部报错的简要 message（避免存全 stack） */
  error?: string;
  created_at: string;
}

export interface CreateTraceStepInput {
  id?: string;
  turn_id: string;
  conversation_id: string;
  message_id?: string;
  step_type: AgentTraceStepType;
  step_order: number;
  input_snapshot_json?: string;
  output_snapshot_json?: string;
  latency_ms?: number;
  error?: string;
}

// ─── V3.5 AgentMessage ──────────────────────────────────────────────────────

/** LLM 上下文中的单条消息，供 contextBuilder / LLMPlanner 使用。 */
export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ─── V3.5 AgentEvent ────────────────────────────────────────────────────────

export type AgentEventType =
  | "plan_proposed"
  | "plan_confirmed"
  | "plan_rejected"
  | "tool_executed"
  | "error";

export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  trace?: AgentTrace;
  payload?: unknown;
}

// ─── V3.5 PlanProposal（Delay / Feedback Agent 化的选项提议） ───────────────

export type AgentPlanMode = "immediate" | "propose" | "clarify";

/** 单个可选执行方案。 */
export interface PlanOption {
  id?: string;
  title?: string;
  label: string;
  toolName: string;
  params: Record<string, unknown>;
  summary: string;
  actions?: Array<{
    toolName: string;
    params: Record<string, unknown>;
    summary?: string;
  }>;
  /**
   * V3.7 P1: UI 层附加动作，不进入 ToolRouter。
   * - open_schedule_dialog: 执行完 create_task 后由 UI 打开调度对话框
   * - split_then_recommend: 创建任务后由 AgentService/UI 串行推荐时段
   */
  uiAction?:
    | { kind: "open_schedule_dialog"; taskId?: string; defaultDurationMinutes?: number }
    | { kind: "split_then_recommend"; durationMinutes: number };
}

/**
 * Agent 向用户提议的多选执行方案。
 * - mode=propose: 展示选项列表，等待用户选择
 * - mode=immediate: 直接执行，无需选择
 * - mode=clarify: 需要用户补充信息
 */
export interface PlanProposal {
  mode: AgentPlanMode;
  options: PlanOption[];
  question?: string;
}
