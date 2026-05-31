import type {
  ConversationMessage,
  CreateMessageInput,
} from "@/types/agent.types";

export interface IConversationRepository {
  create(data: CreateMessageInput): Promise<ConversationMessage>;
  findRecent(limit: number): Promise<ConversationMessage[]>;
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
}
