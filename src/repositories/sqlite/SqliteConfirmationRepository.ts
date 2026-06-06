import { getDb } from "@/db/client";
import type { IConfirmationRepository } from "@/repositories/interfaces/IConfirmationRepository";
import type {
  PendingConfirmation,
  CreateConfirmationInput,
  ConfirmationStatus,
} from "@/types/agent.types";

export class SqliteConfirmationRepository implements IConfirmationRepository {
  async create(data: CreateConfirmationInput): Promise<PendingConfirmation> {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt =
      data.expires_at ?? new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await db.execute(
      `INSERT INTO pending_confirmations
        (id, action_type, tool_name, tool_args_json, description, risk_level, status,
         created_at, expires_at,
         conversation_id, turn_id, message_id, proposal_id,
         related_task_id, related_time_block_id, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        data.action_type,
        data.tool_name,
        data.tool_args_json,
        data.description ?? null,
        data.risk_level ?? "medium",
        "pending",
        now,
        expiresAt,
        data.conversation_id ?? null,
        data.turn_id ?? null,
        data.message_id ?? null,
        data.proposal_id ?? null,
        data.related_task_id ?? null,
        data.related_time_block_id ?? null,
        data.metadata_json ?? null,
      ]
    );

    return {
      id,
      action_type: data.action_type,
      tool_name: data.tool_name,
      tool_args_json: data.tool_args_json,
      description: data.description,
      risk_level: data.risk_level ?? "medium",
      status: "pending",
      created_at: now,
      expires_at: expiresAt,
      conversation_id: data.conversation_id,
      turn_id: data.turn_id,
      message_id: data.message_id,
      proposal_id: data.proposal_id,
      related_task_id: data.related_task_id,
      related_time_block_id: data.related_time_block_id,
      metadata_json: data.metadata_json,
    };
  }

  async findById(id: string): Promise<PendingConfirmation | null> {
    const db = await getDb();
    const rows = await db.select<PendingConfirmation[]>(
      "SELECT * FROM pending_confirmations WHERE id = $1",
      [id]
    );
    return rows[0] ?? null;
  }

  async findPending(): Promise<PendingConfirmation[]> {
    const db = await getDb();
    return db.select<PendingConfirmation[]>(
      "SELECT * FROM pending_confirmations WHERE status = 'pending' ORDER BY created_at DESC"
    );
  }

  async updateStatus(
    id: string,
    status: ConfirmationStatus
  ): Promise<PendingConfirmation> {
    const db = await getDb();
    await db.execute(
      "UPDATE pending_confirmations SET status = $1 WHERE id = $2",
      [status, id]
    );

    const updated = await this.findById(id);
    if (!updated) throw new Error("确认记录不存在");
    return updated;
  }

  async expireOld(beforeDate: string): Promise<number> {
    const db = await getDb();
    const result = await db.execute(
      `UPDATE pending_confirmations
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at < $1`,
      [beforeDate]
    );
    return result.rowsAffected;
  }

  async invalidateByConversation(conversationId: string): Promise<number> {
    const db = await getDb();
    const result = await db.execute(
      `UPDATE pending_confirmations
       SET status = 'invalidated'
       WHERE conversation_id = $1 AND status = 'pending'`,
      [conversationId]
    );
    return result.rowsAffected;
  }

  async invalidateByRelatedTask(taskId: string): Promise<number> {
    const db = await getDb();
    const result = await db.execute(
      `UPDATE pending_confirmations
       SET status = 'invalidated'
       WHERE related_task_id = $1 AND status = 'pending'`,
      [taskId]
    );
    return result.rowsAffected;
  }
}
