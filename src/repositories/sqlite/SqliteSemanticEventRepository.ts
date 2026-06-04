import { getDb } from "@/db/client";
import type { ISemanticEventRepository } from "@/repositories/interfaces/ISemanticEventRepository";
import type { SemanticEvent, CreateSemanticEventInput } from "@/types/agent.types";

export class SqliteSemanticEventRepository implements ISemanticEventRepository {
  async create(data: CreateSemanticEventInput): Promise<SemanticEvent> {
    const db = await getDb();
    const id = data.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const entities_json = data.entities ? JSON.stringify(data.entities) : null;

    await db.execute(
      `INSERT INTO semantic_events
        (id, conversation_id, turn_id, message_id, domain, intent, context_role,
         entities_json, confidence, related_task_id, related_time_block_id,
         related_confirmation_id, related_proposal_id, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        data.conversation_id,
        data.turn_id ?? null,
        data.message_id ?? null,
        data.domain,
        data.intent,
        data.context_role,
        entities_json,
        data.confidence ?? 0.5,
        data.related_task_id ?? null,
        data.related_time_block_id ?? null,
        data.related_confirmation_id ?? null,
        data.related_proposal_id ?? null,
        data.source,
        now,
      ],
    );

    return {
      id,
      conversation_id: data.conversation_id,
      turn_id: data.turn_id,
      message_id: data.message_id,
      domain: data.domain,
      intent: data.intent,
      context_role: data.context_role,
      entities_json: entities_json ?? undefined,
      confidence: data.confidence ?? 0.5,
      related_task_id: data.related_task_id,
      related_time_block_id: data.related_time_block_id,
      related_confirmation_id: data.related_confirmation_id,
      related_proposal_id: data.related_proposal_id,
      source: data.source,
      created_at: now,
    };
  }

  async findByTurn(turnId: string): Promise<SemanticEvent[]> {
    const db = await getDb();
    return db.select<SemanticEvent[]>(
      `SELECT * FROM semantic_events WHERE turn_id = $1 AND invalidated_at IS NULL
       ORDER BY created_at ASC`,
      [turnId],
    );
  }

  async findByConversation(
    conversationId: string,
    opts: { limit?: number; domain?: string; includeInvalidated?: boolean } = {},
  ): Promise<SemanticEvent[]> {
    const db = await getDb();
    const limit = opts.limit ?? 100;
    const invalidatedClause = opts.includeInvalidated ? "" : "AND invalidated_at IS NULL";
    const domainClause = opts.domain ? `AND domain = '${opts.domain.replace(/'/g, "''")}'` : "";

    return db.select<SemanticEvent[]>(
      `SELECT * FROM semantic_events
       WHERE conversation_id = $1 ${invalidatedClause} ${domainClause}
       ORDER BY created_at DESC LIMIT $2`,
      [conversationId, limit],
    );
  }

  async findByTask(taskId: string, limit = 50): Promise<SemanticEvent[]> {
    const db = await getDb();
    return db.select<SemanticEvent[]>(
      `SELECT * FROM semantic_events WHERE related_task_id = $1 AND invalidated_at IS NULL
       ORDER BY created_at DESC LIMIT $2`,
      [taskId, limit],
    );
  }

  async findByTimeBlock(timeBlockId: string, limit = 50): Promise<SemanticEvent[]> {
    const db = await getDb();
    return db.select<SemanticEvent[]>(
      `SELECT * FROM semantic_events WHERE related_time_block_id = $1 AND invalidated_at IS NULL
       ORDER BY created_at DESC LIMIT $2`,
      [timeBlockId, limit],
    );
  }

  async findByConfirmation(confirmationId: string): Promise<SemanticEvent[]> {
    const db = await getDb();
    return db.select<SemanticEvent[]>(
      `SELECT * FROM semantic_events WHERE related_confirmation_id = $1
       ORDER BY created_at ASC`,
      [confirmationId],
    );
  }

  async invalidateByConversation(conversationId: string): Promise<number> {
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db.execute(
      `UPDATE semantic_events SET invalidated_at = $1
       WHERE conversation_id = $2 AND invalidated_at IS NULL`,
      [now, conversationId],
    );
    return (result as { rowsAffected?: number; changes?: number }).rowsAffected ??
      (result as { changes?: number }).changes ?? 0;
  }
}
