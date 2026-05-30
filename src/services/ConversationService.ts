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
}
