import { SqliteActiveContextRepository } from "@/repositories/sqlite/SqliteActiveContextRepository";
import type { IActiveContextRepository } from "@/repositories/interfaces/IActiveContextRepository";
import type {
  ActiveContext,
  SemanticEventDomain,
  SemanticEventIntent,
} from "@/types/agent.types";
import type { PendingProposalSnapshot } from "@/agent/types";

export class ActiveContextService {
  private repo: IActiveContextRepository;

  constructor(repo?: IActiveContextRepository) {
    this.repo = repo ?? new SqliteActiveContextRepository();
  }

  // ── 内部：lazy expiry ─────────────────────────────────────────────────────
  private async expireStaleNow(): Promise<void> {
    await this.repo.expireStale(new Date().toISOString());
  }

  // ── 写入 ──────────────────────────────────────────────────────────────────

  /**
   * destructive / 通用 confirmation 创建时调用。
   * expires_at 取 confirmation.expires_at；若缺省则用 now+5min 兜底。
   */
  async createForConfirmation(input: {
    conversation_id: string;
    confirmation_id: string;
    turn_id?: string;
    active_domain?: SemanticEventDomain;
    active_intent?: SemanticEventIntent;
    related_task_id?: string;
    related_time_block_id?: string;
    expires_at?: string;
  }): Promise<ActiveContext> {
    const expiresAt = input.expires_at ?? this.defaultExpiresAt();
    return this.repo.create({
      conversation_id: input.conversation_id,
      active_confirmation_id: input.confirmation_id,
      active_turn_id: input.turn_id,
      active_domain: input.active_domain,
      active_intent: input.active_intent,
      active_task_id: input.related_task_id,
      active_time_block_id: input.related_time_block_id,
      expires_at: expiresAt,
      status: "active",
    });
  }

  /**
   * recommendation 类提案创建时调用，写入 proposal_snapshot_json。
   * expires_at = min(confirmation.expires_at, now+5min)。
   */
  async createForProposal(input: {
    conversation_id: string;
    confirmation_id: string;
    proposal_id: string;
    proposal_snapshot: PendingProposalSnapshot;
    turn_id?: string;
    active_domain?: SemanticEventDomain;
    active_intent?: SemanticEventIntent;
    related_task_id?: string;
    expires_at?: string;
  }): Promise<ActiveContext> {
    const defaultExp = this.defaultExpiresAt();
    const expiresAt = input.expires_at
      ? (input.expires_at < defaultExp ? input.expires_at : defaultExp)
      : defaultExp;

    return this.repo.create({
      conversation_id: input.conversation_id,
      active_confirmation_id: input.confirmation_id,
      active_proposal_id: input.proposal_id,
      proposal_snapshot_json: JSON.stringify(input.proposal_snapshot),
      active_turn_id: input.turn_id,
      active_domain: input.active_domain,
      active_intent: input.active_intent,
      active_task_id: input.related_task_id,
      expires_at: expiresAt,
      status: "active",
    });
  }

  // ── 查询 ──────────────────────────────────────────────────────────────────

  /** 取该会话最新且 status='active' 的 context；查询前 lazy expire。 */
  async findActiveByConversation(conversationId: string): Promise<ActiveContext | null> {
    await this.expireStaleNow();
    return this.repo.findActiveByConversation(conversationId);
  }

  async findById(id: string): Promise<ActiveContext | null> {
    return this.repo.findById(id);
  }

  async findByConfirmation(confirmationId: string): Promise<ActiveContext | null> {
    return this.repo.findByConfirmation(confirmationId);
  }

  async touchOnUserAction(
    conversationId: string,
    hint: {
      task_id?: string;
      time_block_id?: string;
      intent?: SemanticEventIntent;
    }
  ): Promise<ActiveContext> {
    await this.expireStaleNow();
    const active = await this.repo.findActiveByConversation(conversationId);
    const patch = {
      active_domain: "time_management",
      active_intent: hint.intent ?? "ui_action",
      active_task_id: hint.task_id ?? null,
      active_time_block_id: hint.time_block_id ?? null,
      expires_at: this.defaultExpiresAt(),
    };

    if (active) {
      return this.repo.update(active.id, patch);
    }

    return this.repo.create({
      conversation_id: conversationId,
      active_domain: "time_management",
      active_intent: hint.intent ?? "ui_action",
      active_task_id: hint.task_id,
      active_time_block_id: hint.time_block_id,
      status: "active",
      expires_at: this.defaultExpiresAt(),
    });
  }

  // ── 状态机 ────────────────────────────────────────────────────────────────

  async resolveOnConfirm(confirmationId: string): Promise<void> {
    const ctx = await this.repo.findByConfirmation(confirmationId);
    if (ctx && ctx.status === "active") {
      await this.repo.update(ctx.id, { status: "resolved" });
    }
  }

  async resolveOnReject(confirmationId: string): Promise<void> {
    const ctx = await this.repo.findByConfirmation(confirmationId);
    if (ctx && ctx.status === "active") {
      await this.repo.update(ctx.id, { status: "resolved" });
    }
  }

  /**
   * refine：旧 active_context → status='resolved'，新建一条带 newConfirmationId / newProposal。
   */
  async replaceForRefine(input: {
    old_confirmation_id: string;
    new_confirmation_id: string;
    new_proposal_id: string;
    new_proposal_snapshot: PendingProposalSnapshot;
    conversation_id: string;
    turn_id?: string;
    active_domain?: SemanticEventDomain;
    active_intent?: SemanticEventIntent;
    expires_at?: string;
  }): Promise<ActiveContext> {
    const old = await this.repo.findByConfirmation(input.old_confirmation_id);
    if (old && old.status === "active") {
      await this.repo.update(old.id, { status: "resolved" });
    }
    return this.createForProposal({
      conversation_id: input.conversation_id,
      confirmation_id: input.new_confirmation_id,
      proposal_id: input.new_proposal_id,
      proposal_snapshot: input.new_proposal_snapshot,
      turn_id: input.turn_id,
      active_domain: input.active_domain,
      active_intent: input.active_intent,
      expires_at: input.expires_at,
    });
  }

  /**
   * C5 删除会话时调用；C3 在 chatStore.clearHistory 也会调一次（仅范围内）。
   */
  async invalidateByConversation(conversationId: string): Promise<number> {
    return this.repo.invalidateByConversation(conversationId);
  }

  /** lazy expiry：把 expires_at < now 且 status='active' 的标记为 'expired'。 */
  async expireStale(): Promise<number> {
    return this.repo.expireStale(new Date().toISOString());
  }

  // ── 私有工具 ──────────────────────────────────────────────────────────────

  /** 默认过期时间：now + 5 分钟 */
  private defaultExpiresAt(): string {
    return new Date(Date.now() + 5 * 60 * 1000).toISOString();
  }
}
