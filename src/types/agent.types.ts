import { z } from "zod";

// ============================================================
// Conversation (C1)
// ============================================================

export type ConversationStatus = "active" | "archived" | "deleted";

export interface Conversation {
  id: string;
  title?: string;
  status: ConversationStatus;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export const CreateConversationSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
});

export type CreateConversationInput = z.input<typeof CreateConversationSchema>;

// ============================================================
// Turn (C1)
// ============================================================

export type TurnTrigger =
  | "user_message"
  | "confirm_action"
  | "reject_action"
  | "refine_action"
  | "system";

export type TurnStatus = "in_progress" | "success" | "failed" | "interrupted";

export interface Turn {
  id: string;
  conversation_id: string;
  user_message_id?: string;
  assistant_message_id?: string;
  trigger: TurnTrigger;
  status: TurnStatus;
  started_at: string;
  completed_at?: string;
  error_message?: string;
}

export const CreateTurnSchema = z.object({
  id: z.string().optional(),
  conversation_id: z.string().min(1),
  user_message_id: z.string().optional(),
  trigger: z
    .enum([
      "user_message",
      "confirm_action",
      "reject_action",
      "refine_action",
      "system",
    ])
    .default("user_message"),
});

export type CreateTurnInput = z.input<typeof CreateTurnSchema>;

// ============================================================
// Semantic Event (C2)
// ============================================================

export type SemanticEventDomain =
  | "time_management"
  | "general_chat"
  | "knowledge_qa"
  | "writing_assistant"
  | "external_info"
  | "feedback"
  | "assistant_meta"
  | "low_signal"
  | "unknown";

export type SemanticEventIntent =
  | "create_task"
  | "schedule_task"
  | "reschedule"
  | "delete_task"
  | "complete_task"
  | "query_schedule"
  | "confirm_action"
  | "reject_action"
  | "refine_action"
  | "create_proposal"
  | "ask_question"
  | "casual_chat"
  | "error"
  | string; // 允许扩展

export type SemanticEventContextRole =
  | "new_intent"
  | "continuation"
  | "confirmation_reply"
  | "rejection_reply"
  | "modification"
  | "clarification"
  | "unrelated_insert"
  | "topic_change"
  | "low_signal";

export type SemanticEventSource = "rule" | "llm" | "tool" | "system" | "user_ui";

export interface SemanticEvent {
  id: string;
  conversation_id: string;
  turn_id?: string;
  message_id?: string;
  domain: SemanticEventDomain;
  intent: SemanticEventIntent;
  context_role: SemanticEventContextRole;
  entities_json?: string;
  confidence: number;
  related_task_id?: string;
  related_time_block_id?: string;
  related_confirmation_id?: string;
  related_proposal_id?: string;
  source: SemanticEventSource;
  created_at: string;
  invalidated_at?: string;
}

export const CreateSemanticEventSchema = z.object({
  id: z.string().optional(),
  conversation_id: z.string().min(1),
  turn_id: z.string().optional(),
  message_id: z.string().optional(),
  domain: z.string() as z.ZodType<SemanticEventDomain>,
  intent: z.string() as z.ZodType<SemanticEventIntent>,
  context_role: z.string() as z.ZodType<SemanticEventContextRole>,
  entities: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  related_task_id: z.string().optional(),
  related_time_block_id: z.string().optional(),
  related_confirmation_id: z.string().optional(),
  related_proposal_id: z.string().optional(),
  source: z.enum(["rule", "llm", "tool", "system", "user_ui"]) as z.ZodType<SemanticEventSource>,
});

export type CreateSemanticEventInput = {
  id?: string;
  conversation_id: string;
  turn_id?: string;
  message_id?: string;
  domain: SemanticEventDomain;
  intent: SemanticEventIntent;
  context_role: SemanticEventContextRole;
  entities?: Record<string, unknown>;
  confidence?: number;
  related_task_id?: string;
  related_time_block_id?: string;
  related_confirmation_id?: string;
  related_proposal_id?: string;
  source: SemanticEventSource;
};

// ============================================================
// Action Log
// ============================================================

export type ActionLogStatus =
  | "pending"
  | "executing"
  | "success"
  | "failed"
  | "cancelled";

export interface ActionLog {
  id: string;
  user_input: string;
  detected_intent?: string;
  tool_name?: string;
  tool_args_json?: string;
  tool_result_json?: string;
  status: ActionLogStatus;
  error_message?: string;
  created_at: string;
  /** C2/G10: 会话外键 */
  conversation_id?: string;
  /** C2/G10: 回合外键 */
  turn_id?: string;
  /** C2/G10: 用户消息外键 */
  message_id?: string;
  /** C2/G10: 确认外键 */
  confirmation_id?: string;
}

/** C2/G10: ActionLog 写入时的上下文绑定 */
export interface ActionLogBinding {
  conversation_id?: string;
  turn_id?: string;
  message_id?: string;
  confirmation_id?: string;
}

export const CreateActionLogSchema = z.object({
  user_input: z.string().min(1),
  detected_intent: z.string().optional(),
  tool_name: z.string().optional(),
  tool_args_json: z.string().optional(),
  tool_result_json: z.string().optional(),
  status: z
    .enum(["pending", "executing", "success", "failed", "cancelled"])
    .default("pending"),
  error_message: z.string().optional(),
  // C2/G10: 可选绑定字段
  conversation_id: z.string().optional(),
  turn_id: z.string().optional(),
  message_id: z.string().optional(),
  confirmation_id: z.string().optional(),
});

export type CreateActionLogInput = z.input<typeof CreateActionLogSchema>;

export const UpdateActionLogSchema = z.object({
  detected_intent: z.string().optional(),
  tool_name: z.string().optional(),
  tool_args_json: z.string().optional(),
  tool_result_json: z.string().optional(),
  status: z
    .enum(["pending", "executing", "success", "failed", "cancelled"])
    .optional(),
  error_message: z.string().optional(),
});

export type UpdateActionLogInput = z.infer<typeof UpdateActionLogSchema>;

// ============================================================
// Conversation Message
// ============================================================

export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface ConversationMessage {
  id: string;
  /** C1: 所属会话 ID（migration v6 后必填） */
  conversation_id?: string;
  /** C1: 所属回合 ID（可选，backfill 的历史消息为 null） */
  turn_id?: string;
  role: MessageRole;
  content: string;
  metadata_json?: string;
  created_at: string;
  /** C1: 软删除时间戳（非 null 表示已软删除，不参与上下文检索） */
  deleted_at?: string;
}

export const CreateMessageSchema = z.object({
  /**
   * V3.7 P0-1: 可选客户端预生成 id。
   * 若提供，repo 直接使用；否则 repo 生成 UUID。
   * 用于让前端 in-memory 消息 id 与 DB 行 id 一致，便于后续 updateMetadata。
   */
  id: z.string().optional(),
  /** C1: 所属会话 ID */
  conversation_id: z.string().optional(),
  /** C1: 所属回合 ID */
  turn_id: z.string().optional(),
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string().min(1),
  metadata_json: z.string().optional(),
});

export type CreateMessageInput = z.input<typeof CreateMessageSchema>;

// ============================================================
// Pending Confirmation
// ============================================================

export type RiskLevel = "low" | "medium" | "high";
export type ConfirmationStatus = "pending" | "confirmed" | "rejected" | "expired" | "invalidated";

export interface PendingConfirmation {
  id: string;
  action_type: string;
  tool_name: string;
  tool_args_json: string;
  description?: string;
  risk_level: RiskLevel;
  status: ConfirmationStatus;
  created_at: string;
  expires_at?: string;
  /** C2/G11: 会话外键 */
  conversation_id?: string;
  /** C2/G11: 回合外键 */
  turn_id?: string;
  /** C2/G11: 消息外键 */
  message_id?: string;
  /** C2/G11: 关联提案 ID（recommendation 类） */
  proposal_id?: string;
  /** C2/G11: 关联任务 ID */
  related_task_id?: string;
  /** C2/G11: 关联时间块 ID */
  related_time_block_id?: string;
  /** C2/G11: 扩展元数据 JSON */
  metadata_json?: string;
}

export const CreateConfirmationSchema = z.object({
  action_type: z.string().min(1),
  tool_name: z.string().min(1),
  tool_args_json: z.string().min(1),
  description: z.string().optional(),
  risk_level: z.enum(["low", "medium", "high"]).default("medium"),
  expires_at: z.string().optional(),
  // C2/G11: 可选绑定字段
  conversation_id: z.string().optional(),
  turn_id: z.string().optional(),
  message_id: z.string().optional(),
  proposal_id: z.string().optional(),
  related_task_id: z.string().optional(),
  related_time_block_id: z.string().optional(),
  metadata_json: z.string().optional(),
});

export type CreateConfirmationInput = z.input<typeof CreateConfirmationSchema>;

// ============================================================
// Active Context (C3)
// ============================================================

export type ActiveContextStatus = "active" | "expired" | "resolved" | "invalidated";

export interface ActiveContext {
  id: string;
  conversation_id: string;
  active_domain?: string;
  active_intent?: string;
  /** 关联的任务 ID（可选） */
  active_task_id?: string;
  /** 关联的时间块 ID（可选） */
  active_time_block_id?: string;
  /** 关联的确认 ID（recommendation/destructive confirmation） */
  active_confirmation_id?: string;
  /** 提案 UUID（对应 PendingProposalSnapshot.proposalId） */
  active_proposal_id?: string;
  /** 序列化的 PendingProposalSnapshot，供 Stage 0 恢复 pendingProposal */
  proposal_snapshot_json?: string;
  /** 关联的回合 ID */
  active_turn_id?: string;
  status: ActiveContextStatus;
  /** 过期时间 ISO；超过则 lazy expire */
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export const CreateActiveContextSchema = z.object({
  id: z.string().optional(),
  conversation_id: z.string().min(1),
  active_domain: z.string().optional(),
  active_intent: z.string().optional(),
  active_task_id: z.string().optional(),
  active_time_block_id: z.string().optional(),
  active_confirmation_id: z.string().optional(),
  active_proposal_id: z.string().optional(),
  proposal_snapshot_json: z.string().optional(),
  active_turn_id: z.string().optional(),
  status: z.enum(["active", "expired", "resolved", "invalidated"]).default("active"),
  expires_at: z.string().optional(),
});

export type CreateActiveContextInput = z.input<typeof CreateActiveContextSchema>;

export const UpdateActiveContextSchema = z.object({
  status: z.enum(["active", "expired", "resolved", "invalidated"]).optional(),
  active_domain: z.string().nullable().optional(),
  active_intent: z.string().nullable().optional(),
  expires_at: z.string().optional(),
  active_confirmation_id: z.string().nullable().optional(),
  active_proposal_id: z.string().nullable().optional(),
  proposal_snapshot_json: z.string().nullable().optional(),
  active_task_id: z.string().nullable().optional(),
  active_time_block_id: z.string().nullable().optional(),
  active_turn_id: z.string().nullable().optional(),
});

export type UpdateActiveContextInput = z.input<typeof UpdateActiveContextSchema>;

// ============================================================
// AgentTraceStep (C6)
// ============================================================

export const CreateTraceStepSchema = z.object({
  id: z.string().optional(),
  turn_id: z.string().min(1),
  conversation_id: z.string().min(1),
  message_id: z.string().optional(),
  step_type: z.string().min(1),
  step_order: z.number().int().min(0),
  input_snapshot_json: z.string().optional(),
  output_snapshot_json: z.string().optional(),
  latency_ms: z.number().int().min(0).optional(),
  error: z.string().optional(),
});

export type CreateTraceStepInput = z.input<typeof CreateTraceStepSchema>;

export interface AgentTraceStep {
  id: string;
  turn_id: string;
  conversation_id: string;
  message_id?: string;
  step_type: string;
  step_order: number;
  input_snapshot_json?: string;
  output_snapshot_json?: string;
  latency_ms?: number;
  error?: string;
  created_at: string;
}

// ── ActiveContextRouteHint（ActiveContextResolver 输出，DomainRoutingService Stage 0 消费）

export type ActiveContextHintStatus =
  | "no_active_context"
  | "pending_confirmation"
  | "pending_proposal"
  | "active_task_discussion";

export type ActiveContextRecommendedRoute =
  | "confirmation_resolver"
  | "pending_proposal_interpreter"
  | "time_management"
  | "general_chat"
  | "llm_domain_classifier";

export interface ActiveContextRouteHint {
  status: ActiveContextHintStatus;
  activeContext?: ActiveContext;
  /** 注入下游 ContextualPreRouter 的 pendingConfirmationId */
  pendingConfirmationId?: string;
  /** 注入下游 PendingProposalInterpreter 的 pendingProposal（从 proposal_snapshot_json 反序列化） */
  pendingProposal?: import("@/agent/types").PendingProposalSnapshot;
  recommendedRoute: ActiveContextRecommendedRoute;
  /** 可读 reason，写入 AgentTrace 供调试 */
  reason: string;
}
