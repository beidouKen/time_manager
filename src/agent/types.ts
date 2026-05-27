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
  resultType?: "success" | "failure" | "pending_confirmation" | "rejected";
  source?: "chat" | "heartbeat" | "system" | "llm";
  // V3 新增：LLM 相关元数据
  /** LLM 使用的模型名称（如 deepseek-v4-pro） */
  llmModel?: string;
  /** LLM 解析置信度 0-1 */
  confidence?: number;
  /** LLM 返回的响应类型 */
  llmResponseType?: "tool_plan" | "clarification" | "chitchat" | "unsupported";
}
