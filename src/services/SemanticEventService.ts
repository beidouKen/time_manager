import { SqliteSemanticEventRepository } from "@/repositories/sqlite/SqliteSemanticEventRepository";
import type { ISemanticEventRepository } from "@/repositories/interfaces/ISemanticEventRepository";
import type {
  SemanticEvent,
  SemanticEventDomain,
  CreateSemanticEventInput,
} from "@/types/agent.types";

export class SemanticEventService {
  private repo: ISemanticEventRepository;

  constructor(repo?: ISemanticEventRepository) {
    this.repo = repo ?? new SqliteSemanticEventRepository();
  }

  async recordEvent(input: CreateSemanticEventInput): Promise<SemanticEvent> {
    return this.repo.create(input);
  }

  async recordEvents(inputs: CreateSemanticEventInput[]): Promise<SemanticEvent[]> {
    return Promise.all(inputs.map((i) => this.repo.create(i)));
  }

  async findByTurn(turnId: string): Promise<SemanticEvent[]> {
    return this.repo.findByTurn(turnId);
  }

  async findByConversation(
    conversationId: string,
    opts?: { limit?: number; domain?: SemanticEventDomain; includeInvalidated?: boolean }
  ): Promise<SemanticEvent[]> {
    return this.repo.findByConversation(conversationId, opts);
  }

  async findByTask(taskId: string, limit?: number): Promise<SemanticEvent[]> {
    return this.repo.findByTask(taskId, limit);
  }

  async findByTimeBlock(timeBlockId: string, limit?: number): Promise<SemanticEvent[]> {
    return this.repo.findByTimeBlock(timeBlockId, limit);
  }

  async findByConfirmation(confirmationId: string): Promise<SemanticEvent[]> {
    return this.repo.findByConfirmation(confirmationId);
  }

  /**
   * 批量作废会话下所有语义事件（设置 invalidated_at）。
   * C5 删会话时调用；C2 只暴露接口，不主动触发。
   */
  async invalidateByConversation(conversationId: string): Promise<number> {
    return this.repo.invalidateByConversation(conversationId);
  }
}
