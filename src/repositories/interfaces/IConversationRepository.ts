import type {
  ConversationMessage,
  CreateMessageInput,
} from "@/types/agent.types";

export interface IConversationRepository {
  create(data: CreateMessageInput): Promise<ConversationMessage>;
  findRecent(limit: number): Promise<ConversationMessage[]>;
  findAll(): Promise<ConversationMessage[]>;
  deleteAll(): Promise<void>;
}
