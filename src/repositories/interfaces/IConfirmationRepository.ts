import type {
  PendingConfirmation,
  CreateConfirmationInput,
  ConfirmationStatus,
} from "@/types/agent.types";

export interface IConfirmationRepository {
  create(data: CreateConfirmationInput): Promise<PendingConfirmation>;
  findById(id: string): Promise<PendingConfirmation | null>;
  findPending(): Promise<PendingConfirmation[]>;
  updateStatus(id: string, status: ConfirmationStatus): Promise<PendingConfirmation>;
  expireOld(beforeDate: string): Promise<number>;
  /** C5: 批量把会话下 status='pending' 的 confirmation 改为 'invalidated'；返回影响行数 */
  invalidateByConversation(conversationId: string): Promise<number>;
}
