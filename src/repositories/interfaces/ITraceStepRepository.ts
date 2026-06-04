import type { AgentTraceStep, CreateTraceStepInput } from "@/types/agent.types";

export interface ITraceStepRepository {
  create(data: CreateTraceStepInput): Promise<AgentTraceStep>;
  createBatch(items: CreateTraceStepInput[]): Promise<AgentTraceStep[]>;
  findByTurn(turnId: string): Promise<AgentTraceStep[]>;
  findByMessage(messageId: string): Promise<AgentTraceStep[]>;
  findByConversation(
    conversationId: string,
    opts?: { limit?: number; stepType?: string; since?: string }
  ): Promise<AgentTraceStep[]>;
  findLatestByConversation(conversationId: string, n: number): Promise<AgentTraceStep[]>;
  countByStepType(conversationId: string, stepType: string): Promise<number>;
}
