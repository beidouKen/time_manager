import { z } from "zod";

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

export type MessageRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  metadata_json?: string;
  created_at: string;
}

export const CreateMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  metadata_json: z.string().optional(),
});

export type CreateMessageInput = z.input<typeof CreateMessageSchema>;

// ============================================================
// Pending Confirmation
// ============================================================

export type RiskLevel = "low" | "medium" | "high";
export type ConfirmationStatus = "pending" | "confirmed" | "rejected" | "expired";

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
}

export const CreateConfirmationSchema = z.object({
  action_type: z.string().min(1),
  tool_name: z.string().min(1),
  tool_args_json: z.string().min(1),
  description: z.string().optional(),
  risk_level: z.enum(["low", "medium", "high"]).default("medium"),
  expires_at: z.string().optional(),
});

export type CreateConfirmationInput = z.input<typeof CreateConfirmationSchema>;
