import { getDb } from "@/db/client";
import type { IConversationRepository } from "@/repositories/interfaces/IConversationRepository";
import type {
  ConversationMessage,
  CreateMessageInput,
} from "@/types/agent.types";

export class SqliteConversationRepository implements IConversationRepository {
  async create(data: CreateMessageInput): Promise<ConversationMessage> {
    const db = await getDb();
    const id = data.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO conversation_messages (id, role, content, metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, data.role, data.content, data.metadata_json ?? null, now]
    );

    return {
      id,
      role: data.role,
      content: data.content,
      metadata_json: data.metadata_json,
      created_at: now,
    };
  }

  async findRecent(limit: number): Promise<ConversationMessage[]> {
    const db = await getDb();
    const rows = await db.select<ConversationMessage[]>(
      `SELECT * FROM conversation_messages
       ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return rows.reverse();
  }

  async findAll(): Promise<ConversationMessage[]> {
    const db = await getDb();
    return db.select<ConversationMessage[]>(
      "SELECT * FROM conversation_messages ORDER BY created_at ASC"
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
      [metadataJson, id]
    );
    // Tauri sql 插件返回的 result.rowsAffected 在不同实现下名字略不同；
    // 取保守判断：影响行 > 0 视为成功。
    const affected =
      (result as { rowsAffected?: number; changes?: number }).rowsAffected ??
      (result as { changes?: number }).changes ??
      0;
    return affected > 0;
  }
}
