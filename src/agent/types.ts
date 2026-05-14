export type IntentType =
  | "create_task"
  | "list_tasks"
  | "update_task"
  | "delete_task"
  | "mark_task_completed"
  | "create_time_block"
  | "move_time_block"
  | "delete_time_block"
  | "schedule_task"
  | "reschedule_day"
  | "get_today_plan"
  | "explain_schedule"
  | "unknown";

export interface ParsedIntent {
  intent: IntentType;
  confidence: number;
  args: Record<string, unknown>;
  rawInput: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  message: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  requiresConfirmation: boolean;
  riskLevel: "low" | "medium" | "high";
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
