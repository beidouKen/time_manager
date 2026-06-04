import type { Turn, CreateTurnInput, TurnStatus } from "@/types/agent.types";

export interface ITurnRepository {
  create(data: CreateTurnInput): Promise<Turn>;
  findById(id: string): Promise<Turn | null>;
  findByConversation(conversationId: string, limit?: number): Promise<Turn[]>;
  updateStatus(
    id: string,
    status: TurnStatus,
    extra?: { assistantMessageId?: string; errorMessage?: string; completedAt?: string }
  ): Promise<Turn>;
}
