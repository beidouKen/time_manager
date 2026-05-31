import { SqliteConversationRepository } from "@/repositories/sqlite/SqliteConversationRepository";
import type { IConversationRepository } from "@/repositories/interfaces/IConversationRepository";
import type {
  ConversationMessage,
  CreateMessageInput,
} from "@/types/agent.types";

export class ConversationService {
  private repo: IConversationRepository;

  constructor(repo?: IConversationRepository) {
    this.repo = repo ?? new SqliteConversationRepository();
  }

  async createMessage(data: CreateMessageInput): Promise<ConversationMessage> {
    return this.repo.create(data);
  }

  async loadRecent(limit: number): Promise<ConversationMessage[]> {
    return this.repo.findRecent(limit);
  }

  async clearAll(): Promise<void> {
    return this.repo.deleteAll();
  }

  /**
   * V3.7 P0-1: 更新指定消息的 metadata_json。
   * 用于 confirmAction / rejectAction 后将历史消息的 resultType 从
   * "pending_confirmation" 回写为 "success" / "failure" / "rejected"，
   * 让 ChatMessage 渲染条件失效（按钮消失），且页面刷新后仍然不显示。
   *
   * 调用方负责合并旧 metadata 与新字段，本服务只做整体覆盖式更新。
   * 行不存在时静默成功（返回 false 仅作 trace 用途）。
   */
  async updateMessageMetadata(
    id: string,
    metadataJson: string
  ): Promise<boolean> {
    return this.repo.updateMetadata(id, metadataJson);
  }
}
