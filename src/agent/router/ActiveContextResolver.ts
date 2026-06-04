/**
 * ActiveContextResolver — C3 Stage 0 路由解析器
 *
 * 纯规则类，不调用 LLM，不写库（只读）。
 * 输入会话 + 原始输入文本 → 输出 ActiveContextRouteHint。
 *
 * 规则优先级（见 C3 plan §5.2）：
 *   1. active_confirmation_id + confirmation status='pending' → pending_confirmation
 *   2. 同上 + proposal_snapshot_json 存在             → pending_proposal
 *   3. active_task_id + created_at 在 5 分钟内        → active_task_discussion
 *   4. 其它                                           → no_active_context
 */

import type { ActiveContextRouteHint } from "@/types/agent.types";
import type { ActiveContextService } from "@/services/ActiveContextService";
import type { PendingProposalSnapshot } from "@/agent/types";
import type { ConfirmationService } from "@/services/ConfirmationService";

export interface ActiveContextResolveInput {
  conversationId: string;
  /** 仅用于 trace reason，不影响规则决策 */
  rawInput: string;
  /** 默认 new Date().toISOString() */
  currentDatetime?: string;
  /** 可选：用于校验 active_confirmation_id 状态是否仍 pending */
  confirmationService?: ConfirmationService;
  activeContextService: ActiveContextService;
}

const COOL_OFF_MS = 5 * 60 * 1000; // 5 分钟

export class ActiveContextResolver {
  async resolve(input: ActiveContextResolveInput): Promise<ActiveContextRouteHint> {
    const now = input.currentDatetime ?? new Date().toISOString();

    const activeCtx = await input.activeContextService.findActiveByConversation(
      input.conversationId,
    );

    if (!activeCtx) {
      return {
        status: "no_active_context",
        recommendedRoute: "llm_domain_classifier",
        reason: "no_active_row",
      };
    }

    // ── 规则 1 / 2：有 active_confirmation_id ─────────────────────────────
    if (activeCtx.active_confirmation_id) {
      let confirmationStillPending = true;
      if (input.confirmationService) {
        try {
          const conf = await input.confirmationService.getById(
            activeCtx.active_confirmation_id,
          );
          if (conf !== null && conf !== undefined) {
            // 只有当 service 明确返回记录时才用其 status 做决策；
            // 若 service 无记录（null），信任 active_context 行本身的 status
            confirmationStillPending = conf.status === "pending";
          }
          // conf === null → 保留 confirmationStillPending = true（信任 active_context）
        } catch {
          // service 调用异常 → 保守信任 active_context
        }
      }

      if (confirmationStillPending) {
        // 规则 2：有 proposal_snapshot → pending_proposal
        if (activeCtx.proposal_snapshot_json) {
          let pendingProposal: PendingProposalSnapshot | undefined;
          try {
            pendingProposal = JSON.parse(
              activeCtx.proposal_snapshot_json,
            ) as PendingProposalSnapshot;
          } catch {
            pendingProposal = undefined;
          }

          return {
            status: "pending_proposal",
            activeContext: activeCtx,
            pendingConfirmationId: activeCtx.active_confirmation_id,
            pendingProposal,
            recommendedRoute: "pending_proposal_interpreter",
            reason: "db_active_proposal",
          };
        }

        // 规则 1：仅有 confirmation（destructive 类）
        return {
          status: "pending_confirmation",
          activeContext: activeCtx,
          pendingConfirmationId: activeCtx.active_confirmation_id,
          recommendedRoute: "confirmation_resolver",
          reason: "db_active_confirmation",
        };
      }
    }

    // ── 规则 3：active_task_id + cool-off 窗口 ────────────────────────────
    if (activeCtx.active_task_id) {
      const createdMs = new Date(activeCtx.created_at).getTime();
      const nowMs = new Date(now).getTime();
      if (nowMs - createdMs <= COOL_OFF_MS) {
        return {
          status: "active_task_discussion",
          activeContext: activeCtx,
          recommendedRoute: "time_management",
          reason: "recent_task_discussion",
        };
      }
    }

    // ── 规则 4：fallback ──────────────────────────────────────────────────
    return {
      status: "no_active_context",
      activeContext: activeCtx,
      recommendedRoute: "llm_domain_classifier",
      reason: "no_active_row",
    };
  }
}
