import { getDb } from "@/db/client";
import type { IActionLogRepository } from "@/repositories/interfaces/IActionLogRepository";
import type {
  ActionLog,
  CreateActionLogInput,
  UpdateActionLogInput,
} from "@/types/agent.types";

export class SqliteActionLogRepository implements IActionLogRepository {
  async create(data: CreateActionLogInput): Promise<ActionLog> {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO agent_action_logs (id, user_input, detected_intent, tool_name, tool_args_json, tool_result_json, status, error_message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        data.user_input,
        data.detected_intent ?? null,
        data.tool_name ?? null,
        data.tool_args_json ?? null,
        data.tool_result_json ?? null,
        data.status ?? "pending",
        data.error_message ?? null,
        now,
      ]
    );

    return {
      id,
      user_input: data.user_input,
      detected_intent: data.detected_intent,
      tool_name: data.tool_name,
      tool_args_json: data.tool_args_json,
      tool_result_json: data.tool_result_json,
      status: data.status ?? "pending",
      error_message: data.error_message,
      created_at: now,
    };
  }

  async findById(id: string): Promise<ActionLog | null> {
    const db = await getDb();
    const rows = await db.select<ActionLog[]>(
      "SELECT * FROM agent_action_logs WHERE id = $1",
      [id]
    );
    return rows[0] ?? null;
  }

  async findAll(limit = 100): Promise<ActionLog[]> {
    const db = await getDb();
    return db.select<ActionLog[]>(
      "SELECT * FROM agent_action_logs ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
  }

  async update(id: string, data: UpdateActionLogInput): Promise<ActionLog> {
    const db = await getDb();

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.detected_intent !== undefined) {
      fields.push(`detected_intent = $${idx++}`);
      values.push(data.detected_intent);
    }
    if (data.tool_name !== undefined) {
      fields.push(`tool_name = $${idx++}`);
      values.push(data.tool_name);
    }
    if (data.tool_args_json !== undefined) {
      fields.push(`tool_args_json = $${idx++}`);
      values.push(data.tool_args_json);
    }
    if (data.tool_result_json !== undefined) {
      fields.push(`tool_result_json = $${idx++}`);
      values.push(data.tool_result_json);
    }
    if (data.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(data.status);
    }
    if (data.error_message !== undefined) {
      fields.push(`error_message = $${idx++}`);
      values.push(data.error_message);
    }

    if (fields.length > 0) {
      values.push(id);
      await db.execute(
        `UPDATE agent_action_logs SET ${fields.join(", ")} WHERE id = $${idx}`,
        values
      );
    }

    const updated = await this.findById(id);
    if (!updated) throw new Error("日志记录不存在");
    return updated;
  }
}
