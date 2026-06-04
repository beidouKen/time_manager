import { getDb } from "@/db/client";
import type { ITurnRepository } from "@/repositories/interfaces/ITurnRepository";
import type { Turn, CreateTurnInput, TurnStatus } from "@/types/agent.types";

export class SqliteTurnRepository implements ITurnRepository {
  async create(data: CreateTurnInput): Promise<Turn> {
    const db = await getDb();
    const id = data.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO turns (id, conversation_id, user_message_id, trigger, status, started_at)
       VALUES ($1, $2, $3, $4, 'in_progress', $5)`,
      [id, data.conversation_id, data.user_message_id ?? null, data.trigger ?? "user_message", now],
    );

    return {
      id,
      conversation_id: data.conversation_id,
      user_message_id: data.user_message_id,
      trigger: data.trigger ?? "user_message",
      status: "in_progress",
      started_at: now,
    };
  }

  async findById(id: string): Promise<Turn | null> {
    const db = await getDb();
    const rows = await db.select<Turn[]>(
      `SELECT * FROM turns WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByConversation(conversationId: string, limit = 50): Promise<Turn[]> {
    const db = await getDb();
    return db.select<Turn[]>(
      `SELECT * FROM turns WHERE conversation_id = $1 ORDER BY started_at DESC LIMIT $2`,
      [conversationId, limit],
    );
  }

  async updateStatus(
    id: string,
    status: TurnStatus,
    extra?: { assistantMessageId?: string; errorMessage?: string; completedAt?: string },
  ): Promise<Turn> {
    const db = await getDb();
    const now = extra?.completedAt ?? new Date().toISOString();
    const isTerminal = status !== "in_progress";

    await db.execute(
      `UPDATE turns
       SET status = $1,
           completed_at = $2,
           assistant_message_id = COALESCE($3, assistant_message_id),
           error_message = COALESCE($4, error_message)
       WHERE id = $5`,
      [
        status,
        isTerminal ? now : null,
        extra?.assistantMessageId ?? null,
        extra?.errorMessage ?? null,
        id,
      ],
    );

    const rows = await db.select<Turn[]>(`SELECT * FROM turns WHERE id = $1`, [id]);
    if (!rows[0]) throw new Error(`Turn not found: ${id}`);
    return rows[0];
  }
}
