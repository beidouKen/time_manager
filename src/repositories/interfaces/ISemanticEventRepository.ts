import type { SemanticEvent, CreateSemanticEventInput } from "@/types/agent.types";

export interface ISemanticEventRepository {
  create(data: CreateSemanticEventInput): Promise<SemanticEvent>;
  findByTurn(turnId: string): Promise<SemanticEvent[]>;
  findByConversation(
    conversationId: string,
    opts?: { limit?: number; domain?: string; includeInvalidated?: boolean }
  ): Promise<SemanticEvent[]>;
  findByTask(taskId: string, limit?: number): Promise<SemanticEvent[]>;
  findByTimeBlock(timeBlockId: string, limit?: number): Promise<SemanticEvent[]>;
  findByConfirmation(confirmationId: string): Promise<SemanticEvent[]>;
  invalidateByConversation(conversationId: string): Promise<number>;
}
