import { getDb } from "@/db/client";
import type { IActiveContextRepository } from "@/repositories/interfaces/IActiveContextRepository";
import type {
  ActiveContext,
  CreateActiveContextInput,
  UpdateActiveContextInput,
} from "@/types/agent.types";

export class SqliteActiveContextRepository implements IActiveContextRepository {
  async create(data: CreateActiveContextInput): Promise<ActiveContext> {
    const db = await getDb();
    const id = data.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO active_contexts
        (id, conversation_id, active_domain, active_intent,
         active_task_id, active_time_block_id, active_confirmation_id,
         active_proposal_id, proposal_snapshot_json, active_turn_id,
         status, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        data.conversation_id,
        data.active_domain ?? null,
        data.active_intent ?? null,
        data.active_task_id ?? null,
        data.active_time_block_id ?? null,
        data.active_confirmation_id ?? null,
        data.active_proposal_id ?? null,
        data.proposal_snapshot_json ?? null,
        data.active_turn_id ?? null,
        data.status ?? "active",
        data.expires_at ?? null,
        now,
        now,
      ],
    );

    return {
      id,
      conversation_id: data.conversation_id,
      active_domain: data.active_domain,
      active_intent: data.active_intent,
      active_task_id: data.active_task_id,
      active_time_block_id: data.active_time_block_id,
      active_confirmation_id: data.active_confirmation_id,
      active_proposal_id: data.active_proposal_id,
      proposal_snapshot_json: data.proposal_snapshot_json,
      active_turn_id: data.active_turn_id,
      status: data.status ?? "active",
      expires_at: data.expires_at,
      created_at: now,
      updated_at: now,
    };
  }

  async update(id: string, input: UpdateActiveContextInput): Promise<ActiveContext> {
    const db = await getDb();
    const now = new Date().toISOString();

    const setClauses: string[] = ["updated_at = $1"];
    const params: unknown[] = [now];
    let idx = 2;

    if (input.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      params.push(input.status);
    }
    if ("active_domain" in input) {
      setClauses.push(`active_domain = $${idx++}`);
      params.push(input.active_domain ?? null);
    }
    if ("active_intent" in input) {
      setClauses.push(`active_intent = $${idx++}`);
      params.push(input.active_intent ?? null);
    }
    if (input.expires_at !== undefined) {
      setClauses.push(`expires_at = $${idx++}`);
      params.push(input.expires_at);
    }
    if ("active_confirmation_id" in input) {
      setClauses.push(`active_confirmation_id = $${idx++}`);
      params.push(input.active_confirmation_id ?? null);
    }
    if ("active_proposal_id" in input) {
      setClauses.push(`active_proposal_id = $${idx++}`);
      params.push(input.active_proposal_id ?? null);
    }
    if ("proposal_snapshot_json" in input) {
      setClauses.push(`proposal_snapshot_json = $${idx++}`);
      params.push(input.proposal_snapshot_json ?? null);
    }
    if ("active_task_id" in input) {
      setClauses.push(`active_task_id = $${idx++}`);
      params.push(input.active_task_id ?? null);
    }
    if ("active_time_block_id" in input) {
      setClauses.push(`active_time_block_id = $${idx++}`);
      params.push(input.active_time_block_id ?? null);
    }
    if ("active_turn_id" in input) {
      setClauses.push(`active_turn_id = $${idx++}`);
      params.push(input.active_turn_id ?? null);
    }

    params.push(id);
    await db.execute(
      `UPDATE active_contexts SET ${setClauses.join(", ")} WHERE id = $${idx}`,
      params,
    );

    const row = await this.findById(id);
    if (!row) throw new Error(`ActiveContext ${id} not found after update`);
    return row;
  }

  async findById(id: string): Promise<ActiveContext | null> {
    const db = await getDb();
    const rows = await db.select<ActiveContext[]>(
      `SELECT * FROM active_contexts WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findActiveByConversation(conversationId: string): Promise<ActiveContext | null> {
    const db = await getDb();
    const rows = await db.select<ActiveContext[]>(
      `SELECT * FROM active_contexts
       WHERE conversation_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId],
    );
    return rows[0] ?? null;
  }

  async findByConfirmation(confirmationId: string): Promise<ActiveContext | null> {
    const db = await getDb();
    const rows = await db.select<ActiveContext[]>(
      `SELECT * FROM active_contexts
       WHERE active_confirmation_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [confirmationId],
    );
    return rows[0] ?? null;
  }

  async expireStale(now: string): Promise<number> {
    const db = await getDb();
    const result = await db.execute(
      `UPDATE active_contexts
       SET status = 'expired', updated_at = $1
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < $2`,
      [now, now],
    );
    return (result as { rowsAffected?: number; changes?: number }).rowsAffected ??
      (result as { changes?: number }).changes ?? 0;
  }

  async invalidateByConversation(conversationId: string): Promise<number> {
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db.execute(
      `UPDATE active_contexts
       SET status = 'invalidated', updated_at = $1
       WHERE conversation_id = $2 AND status = 'active'`,
      [now, conversationId],
    );
    return (result as { rowsAffected?: number; changes?: number }).rowsAffected ??
      (result as { changes?: number }).changes ?? 0;
  }

  async invalidateByActiveTaskId(taskId: string): Promise<number> {
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db.execute(
      `UPDATE active_contexts
       SET status = 'invalidated', updated_at = $1
       WHERE active_task_id = $2 AND status = 'active'`,
      [now, taskId],
    );
    return (result as { rowsAffected?: number; changes?: number }).rowsAffected ??
      (result as { changes?: number }).changes ?? 0;
  }
}
