import { SqliteTurnRepository } from "@/repositories/sqlite/SqliteTurnRepository";
import type { ITurnRepository } from "@/repositories/interfaces/ITurnRepository";
import type { Turn, TurnTrigger } from "@/types/agent.types";

export class TurnService {
  private repo: ITurnRepository;

  constructor(repo?: ITurnRepository) {
    this.repo = repo ?? new SqliteTurnRepository();
  }

  /**
   * 开始一个新的 Turn，初始状态为 in_progress。
   */
  async startTurn(input: {
    conversationId: string;
    userMessageId?: string;
    trigger: TurnTrigger;
  }): Promise<Turn> {
    return this.repo.create({
      conversation_id: input.conversationId,
      user_message_id: input.userMessageId,
      trigger: input.trigger,
    });
  }

  /**
   * 成功完成一个 Turn，绑定 assistantMessageId。
   */
  async completeTurn(turnId: string, assistantMessageId: string): Promise<Turn> {
    return this.repo.updateStatus(turnId, "success", { assistantMessageId });
  }

  /**
   * 标记 Turn 失败，记录错误信息。
   */
  async failTurn(turnId: string, errorMessage: string): Promise<Turn> {
    return this.repo.updateStatus(turnId, "failed", { errorMessage });
  }

  /**
   * 中断一个 Turn（兜底，处理极端 finally 路径）。
   */
  async interruptTurn(turnId: string): Promise<Turn> {
    return this.repo.updateStatus(turnId, "interrupted");
  }

  async getTurn(id: string): Promise<Turn | null> {
    return this.repo.findById(id);
  }

  async listTurns(conversationId: string, limit = 50): Promise<Turn[]> {
    return this.repo.findByConversation(conversationId, limit);
  }
}
