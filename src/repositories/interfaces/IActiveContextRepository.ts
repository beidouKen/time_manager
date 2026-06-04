import type {
  ActiveContext,
  CreateActiveContextInput,
  UpdateActiveContextInput,
} from "@/types/agent.types";

export interface IActiveContextRepository {
  create(input: CreateActiveContextInput): Promise<ActiveContext>;
  update(id: string, input: UpdateActiveContextInput): Promise<ActiveContext>;
  findById(id: string): Promise<ActiveContext | null>;
  /**
   * 取该会话最新且 status='active' 的 context（按 created_at DESC LIMIT 1）。
   * 不调用 expireStale — 调用方（Service）负责在此之前调用。
   */
  findActiveByConversation(conversationId: string): Promise<ActiveContext | null>;
  findByConfirmation(confirmationId: string): Promise<ActiveContext | null>;
  /**
   * 把 expires_at < now 且 status='active' 的行全部标为 'expired'。
   * 返回受影响的行数。
   */
  expireStale(now: string): Promise<number>;
  /**
   * 把该会话所有 status='active' 的行标为 'invalidated'。
   * 返回受影响的行数。
   */
  invalidateByConversation(conversationId: string): Promise<number>;
}
