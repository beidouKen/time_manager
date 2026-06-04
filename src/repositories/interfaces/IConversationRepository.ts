import type {
  Conversation,
  ConversationMessage,
  CreateConversationInput,
  CreateMessageInput,
} from "@/types/agent.types";

export interface IConversationRepository {
  // ── message CRUD (原有) ────────────────────────────────────────────────────
  create(data: CreateMessageInput): Promise<ConversationMessage>;
  /** 按创建时间倒序取最近 N 条；C1 后排除 deleted_at IS NOT NULL */
  findRecent(limit: number, conversationId?: string): Promise<ConversationMessage[]>;
  findAll(): Promise<ConversationMessage[]>;
  deleteAll(): Promise<void>;
  /**
   * V3.7 P0-1: 更新单条消息的 metadata_json。
   * 用于 confirmAction / rejectAction 后回写历史消息的 resultType，
   * 避免页面刷新后旧消息仍显示确认按钮。
   *
   * 行不存在时不抛错，返回 false。
   */
  updateMetadata(id: string, metadataJson: string): Promise<boolean>;

  // ── conversation CRUD (C1) ─────────────────────────────────────────────────
  createConversation(data: CreateConversationInput): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(filter?: { status?: string }): Promise<Conversation[]>;
  /**
   * 软删除会话：写 conversations.deleted_at。
   * C5 扩展：同时批量软删该会话下所有 deleted_at IS NULL 的消息。
   * 返回结构化结果：{ conversation: 1|0, messages: number }
   */
  softDeleteConversation(id: string): Promise<{ conversation: number; messages: number }>;
  /** 如不存在则创建一个 title='default' 的 active 会话，幂等 */
  ensureDefaultConversation(): Promise<Conversation>;
}
