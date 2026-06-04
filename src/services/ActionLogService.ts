import { SqliteActionLogRepository } from "@/repositories/sqlite/SqliteActionLogRepository";
import type { IActionLogRepository } from "@/repositories/interfaces/IActionLogRepository";
import type {
  ActionLog,
  ActionLogBinding,
  ActionLogStatus,
  CreateActionLogInput,
} from "@/types/agent.types";
import { CreateActionLogSchema } from "@/types/agent.types";

export class ActionLogService {
  private repo: IActionLogRepository;

  constructor(repo?: IActionLogRepository) {
    this.repo = repo ?? new SqliteActionLogRepository();
  }

  async logRequest(
    userInput: string,
    detectedIntent?: string,
    binding?: ActionLogBinding
  ): Promise<ActionLog> {
    const input: CreateActionLogInput = {
      user_input: userInput,
      detected_intent: detectedIntent,
      status: "pending",
      // C2/G10: 透传绑定字段
      conversation_id: binding?.conversation_id,
      turn_id: binding?.turn_id,
      message_id: binding?.message_id,
      confirmation_id: binding?.confirmation_id,
    };
    const validated = CreateActionLogSchema.parse(input);
    return this.repo.create(validated);
  }

  async logToolExecution(
    logId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<ActionLog> {
    return this.repo.update(logId, {
      tool_name: toolName,
      tool_args_json: JSON.stringify(toolArgs),
      status: "executing",
    });
  }

  async logSuccess(
    logId: string,
    result: unknown
  ): Promise<ActionLog> {
    return this.repo.update(logId, {
      tool_result_json: JSON.stringify(result),
      status: "success",
    });
  }

  async logFailure(
    logId: string,
    errorMessage: string
  ): Promise<ActionLog> {
    return this.repo.update(logId, {
      status: "failed",
      error_message: errorMessage,
    });
  }

  async logCancelled(logId: string): Promise<ActionLog> {
    return this.repo.update(logId, { status: "cancelled" });
  }

  async updateStatus(
    logId: string,
    status: ActionLogStatus
  ): Promise<ActionLog> {
    return this.repo.update(logId, { status });
  }

  async getRecentLogs(limit = 50): Promise<ActionLog[]> {
    return this.repo.findAll(limit);
  }

  async getLogById(id: string): Promise<ActionLog | null> {
    return this.repo.findById(id);
  }
}
