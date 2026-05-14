import type { ToolDefinition, ToolResult } from "@/agent/types";

export abstract class BaseTool implements ToolDefinition {
  abstract name: string;
  abstract description: string;
  abstract requiresConfirmation: boolean;
  abstract riskLevel: "low" | "medium" | "high";
  abstract execute(args: Record<string, unknown>): Promise<ToolResult>;

  protected success(message: string, data?: unknown): ToolResult {
    return { success: true, message, data };
  }

  protected failure(error: string): ToolResult {
    return { success: false, message: error, error };
  }
}
