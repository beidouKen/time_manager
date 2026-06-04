import { getDb } from "@/db/client";
import type { IConversationRepository } from "@/repositories/interfaces/IConversationRepository";
import type {
  Conversation,
  ConversationMessage,
  CreateConversationInput,
  CreateMessageInput,
} from "@/types/agent.types";

const DEFAULT_CONVERSATION_ID = "default";

export class SqliteConversationRepository implements IConversationRepository {
  // ── message CRUD ────────────────────────────────────────────────────────────

  async create(data: CreateMessageInput): Promise<ConversationMessage> {
    const db = await getDb();
    const id = data.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO conversation_messages (id, conversation_id, turn_id, role, content, metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        data.conversation_id ?? "legacy-default",
        data.turn_id ?? null,
        data.role,
        data.content,
        data.metadata_json ?? null,
        now,
      ],
    );

    return {
      id,
      conversation_id: data.conversation_id ?? "legacy-default",
      turn_id: data.turn_id,
      role: data.role,
      content: data.content,
      metadata_json: data.metadata_json,
      created_at: now,
    };
  }

  async findRecent(limit: number, conversationId?: string): Promise<ConversationMessage[]> {
    const db = await getDb();
    const rows = await db.select<ConversationMessage[]>(
      `SELECT * FROM conversation_messages
       WHERE deleted_at IS NULL
         AND ($1 IS NULL OR conversation_id = $1)
       ORDER BY created_at DESC LIMIT $2`,
      [conversationId ?? null, limit],
    );
    return rows.reverse();
  }

  async findAll(): Promise<ConversationMessage[]> {
    const db = await getDb();
    return db.select<ConversationMessage[]>(
      "SELECT * FROM conversation_messages WHERE deleted_at IS NULL ORDER BY created_at ASC",
    );
  }

  async deleteAll(): Promise<void> {
    const db = await getDb();
    await db.execute("DELETE FROM conversation_messages");
  }

  async updateMetadata(id: string, metadataJson: string): Promise<boolean> {
    const db = await getDb();
    const result = await db.execute(
      `UPDATE conversation_messages SET metadata_json = $1 WHERE id = $2`,
      [metadataJson, id],
    );
    const affected =
      (result as { rowsAffected?: number; changes?: number }).rowsAffected ??
      (result as { changes?: number }).changes ??
      0;
    return affected > 0;
  }

  // ── conversation CRUD (C1) ──────────────────────────────────────────────────

  async createConversation(data: CreateConversationInput): Promise<Conversation> {
    const db = await getDb();
    const id = data.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO conversations (id, title, status, created_at, updated_at)
       VALUES ($1, $2, 'active', $3, $3)`,
      [id, data.title ?? null, now],
    );

    return {
      id,
      title: data.title,
      status: "active",
      created_at: now,
      updated_at: now,
    };
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const db = await getDb();
    const rows = await db.select<Conversation[]>(
      `SELECT * FROM conversations WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listConversations(filter?: { status?: string }): Promise<Conversation[]> {
    const db = await getDb();
    if (filter?.status) {
      return db.select<Conversation[]>(
        `SELECT * FROM conversations WHERE status = $1 ORDER BY created_at DESC`,
        [filter.status],
      );
    }
    return db.select<Conversation[]>(
      `SELECT * FROM conversations ORDER BY created_at DESC`,
    );
  }

  async softDeleteConversation(id: string): Promise<{ conversation: number; messages: number }> {
    const db = await getDb();
    const now = new Date().toISOString();
    const convResult = await db.execute(
      `UPDATE conversations SET status = 'deleted', deleted_at = $1, updated_at = $1
       WHERE id = $2 AND deleted_at IS NULL`,
      [now, id],
    );
    const msgResult = await db.execute(
      `UPDATE conversation_messages SET deleted_at = $1
       WHERE conversation_id = $2 AND deleted_at IS NULL`,
      [now, id],
    );
    return {
      conversation: convResult.rowsAffected ?? 0,
      messages: msgResult.rowsAffected ?? 0,
    };
  }

  async ensureDefaultConversation(): Promise<Conversation> {
    const db = await getDb();
    // 查找最新一个 active 的非 legacy-default 会话
    const rows = await db.select<Conversation[]>(
      `SELECT * FROM conversations
       WHERE status = 'active' AND id != 'legacy-default'
       ORDER BY created_at DESC LIMIT 1`,
    );
    if (rows[0]) return rows[0];

    // 不存在则创建
    const id = DEFAULT_CONVERSATION_ID + "-" + crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    await db.execute(
      `INSERT OR IGNORE INTO conversations (id, title, status, created_at, updated_at)
       VALUES ($1, 'default', 'active', $2, $2)`,
      [id, now],
    );
    // 取回（可能是刚插入的，也可能并发中已有别人插入）
    const inserted = await db.select<Conversation[]>(
      `SELECT * FROM conversations WHERE id = $1`,
      [id],
    );
    return inserted[0] ?? { id, title: "default", status: "active", created_at: now, updated_at: now };
  }
}
