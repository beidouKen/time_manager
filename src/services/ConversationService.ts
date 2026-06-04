import { SqliteConversationRepository } from "@/repositories/sqlite/SqliteConversationRepository";
import type { IConversationRepository } from "@/repositories/interfaces/IConversationRepository";
import type {
  Conversation,
  ConversationMessage,
  ConversationStatus,
  CreateConversationInput,
  CreateMessageInput,
} from "@/types/agent.types";

export class ConversationService {
  private repo: IConversationRepository;

  constructor(repo?: IConversationRepository) {
    this.repo = repo ?? new SqliteConversationRepository();
  }

  // ── message API ────────────────────────────────────────────────────────────

  async createMessage(data: CreateMessageInput): Promise<ConversationMessage> {
    return this.repo.create(data);
  }

  /**
   * 加载最近 N 条消息。
   * C1 后支持按 conversationId 过滤，且自动排除 deleted_at IS NOT NULL 的软删除行。
   * 不传 conversationId 则读取所有非软删除消息。
   */
  async loadRecent(limit: number, conversationId?: string): Promise<ConversationMessage[]> {
    return this.repo.findRecent(limit, conversationId);
  }

  /**
   * 清空消息（旧行为：直接 DELETE ALL）。
   * C1 后行为变更为：soft-delete 当前 default conversation + 创建新 default。
   * 保留旧方法入口以免破坏已有测试。
   *
   * 注：clearAll 不再物理删除，完整级联失效留 C5。
   */
  async clearAll(): Promise<void> {
    return this.repo.deleteAll();
  }

  /**
   * V3.7 P0-1: 更新指定消息的 metadata_json。
   */
  async updateMessageMetadata(id: string, metadataJson: string): Promise<boolean> {
    return this.repo.updateMetadata(id, metadataJson);
  }

  // ── conversation API (C1) ──────────────────────────────────────────────────

  async createConversation(input?: CreateConversationInput): Promise<Conversation> {
    return this.repo.createConversation(input ?? {});
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return this.repo.getConversation(id);
  }

  async listConversations(filter?: { status?: ConversationStatus }): Promise<Conversation[]> {
    return this.repo.listConversations(filter);
  }

  /**
   * C5: 软删除会话同时批量软删其下所有消息。
   * 返回 { conversation: 影响行数, messages: 影响行数 }；幂等。
   */
  async softDeleteConversation(id: string): Promise<{ conversation: number; messages: number }> {
    return this.repo.softDeleteConversation(id);
  }

  /**
   * 幂等：返回现有 active 会话（非 legacy-default）；
   * 不存在时自动创建一个新的 default 会话。
   */
  async ensureDefaultConversation(): Promise<Conversation> {
    return this.repo.ensureDefaultConversation();
  }
}
