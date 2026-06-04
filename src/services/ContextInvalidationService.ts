import { ConversationService } from "@/services/ConversationService";
import { ActiveContextService } from "@/services/ActiveContextService";
import { SemanticEventService } from "@/services/SemanticEventService";
import { ConfirmationService } from "@/services/ConfirmationService";

// ─── 类型 ────────────────────────────────────────────────────────────────────

export type InvalidateReason =
  | "user_clear"
  | "archive"
  | "admin"
  | "cleanup_legacy";

export interface InvalidateOptions {
  reason: InvalidateReason;
  /** 默认 true：cascade 之前先执行一次 lazy expiry，清理自然过期但状态仍 pending 的边缘记录 */
  expireBeforeCascade?: boolean;
}

export interface CascadeResult {
  messagesDeleted: number;
  conversationDeleted: number;
  activeContextsInvalidated: number;
  eventsInvalidated: number;
  confirmationsInvalidated: number;
  warnings: string[];
}

// ─── ContextInvalidationService ──────────────────────────────────────────────

/**
 * C5: 统一治理入口。
 * 单一职责：接收 conversationId，把该会话的全部上下文实体置入失效状态。
 *
 * 级联顺序（强语义）：
 *   1. （可选）lazy expire：ConfirmationService.expireStale + ActiveContextService.expireStale
 *   2. messages 软删：ConversationService.softDeleteConversation（含消息批量软删）
 *   3. active_contexts 失效：ActiveContextService.invalidateByConversation
 *   4. semantic_events 失效：SemanticEventService.invalidateByConversation
 *   5. pending_confirmations 失效：ConfirmationService.invalidateByConversation
 *
 * 任意子层失败不阻塞其他子层，全部 try/catch + warnings 收集；整体 resolve。
 * 幂等：多次调用结果稳定（第二次调用影响行数为 0）。
 */
export class ContextInvalidationService {
  private conversationService: ConversationService;
  private activeContextService: ActiveContextService;
  private semanticEventService: SemanticEventService;
  private confirmationService: ConfirmationService;

  constructor(options?: {
    conversationService?: ConversationService;
    activeContextService?: ActiveContextService;
    semanticEventService?: SemanticEventService;
    confirmationService?: ConfirmationService;
  }) {
    this.conversationService = options?.conversationService ?? new ConversationService();
    this.activeContextService = options?.activeContextService ?? new ActiveContextService();
    this.semanticEventService = options?.semanticEventService ?? new SemanticEventService();
    this.confirmationService = options?.confirmationService ?? new ConfirmationService();
  }

  async invalidateConversation(
    conversationId: string,
    options: InvalidateOptions
  ): Promise<CascadeResult> {
    const { expireBeforeCascade = true } = options;
    const warnings: string[] = [];

    // ── 0. 前置 lazy expire（可选）────────────────────────────────────────────
    if (expireBeforeCascade) {
      try {
        await this.confirmationService.expireStale();
      } catch (err) {
        warnings.push(`expireStale(confirmation) failed: ${String(err)}`);
      }
      try {
        await this.activeContextService.expireStale();
      } catch (err) {
        warnings.push(`expireStale(activeContext) failed: ${String(err)}`);
      }
    }

    // ── 1. 软删消息 + 会话 ─────────────────────────────────────────────────────
    let messagesDeleted = 0;
    let conversationDeleted = 0;
    try {
      const result = await this.conversationService.softDeleteConversation(conversationId);
      conversationDeleted = result.conversation;
      messagesDeleted = result.messages;
    } catch (err) {
      warnings.push(`softDeleteConversation failed: ${String(err)}`);
      console.warn("[ContextInvalidationService] softDeleteConversation failed:", err);
    }

    // ── 2. active_contexts 失效 ────────────────────────────────────────────────
    let activeContextsInvalidated = 0;
    try {
      activeContextsInvalidated = await this.activeContextService.invalidateByConversation(conversationId);
    } catch (err) {
      warnings.push(`invalidateByConversation(activeContext) failed: ${String(err)}`);
      console.warn("[ContextInvalidationService] invalidateByConversation(activeContext) failed:", err);
    }

    // ── 3. semantic_events 失效 ────────────────────────────────────────────────
    let eventsInvalidated = 0;
    try {
      eventsInvalidated = await this.semanticEventService.invalidateByConversation(conversationId);
    } catch (err) {
      warnings.push(`invalidateByConversation(semanticEvent) failed: ${String(err)}`);
      console.warn("[ContextInvalidationService] invalidateByConversation(semanticEvent) failed:", err);
    }

    // ── 4. pending_confirmations 失效 ──────────────────────────────────────────
    let confirmationsInvalidated = 0;
    try {
      confirmationsInvalidated = await this.confirmationService.invalidateByConversation(conversationId);
    } catch (err) {
      warnings.push(`invalidateByConversation(confirmation) failed: ${String(err)}`);
      console.warn("[ContextInvalidationService] invalidateByConversation(confirmation) failed:", err);
    }

    return {
      messagesDeleted,
      conversationDeleted,
      activeContextsInvalidated,
      eventsInvalidated,
      confirmationsInvalidated,
      warnings,
    };
  }
}
