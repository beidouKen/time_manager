// ============================================================
// ContextualPreRouter — V3.7 P1
//
// 三段式路由器第一段：处理高确定性状态，不调 LLM。
// 返回 null 表示未命中，由后续路由段继续处理。
// ============================================================

import type { AgentRouteResult } from "@/agent/types";

const PURE_NOISE_PATTERN = /^[\s\p{P}\p{S}]*$/u;

const CONFIRM_WORDS = /^(好|确认|可以|yes|ok|y|对|嗯|行|没问题|好的|同意|确定)[！!。.，,\s]*$/iu;
const REJECT_WORDS = /^(取消|不|不要|no|n|算了|不用了|放弃|拒绝)[！!。.，,\s]*$/iu;

// 推迟/调后：再晚一点、晚一点、晚点、再往后、稍晚
const ADJUST_LATER_WORDS = /再晚|晚[一点些]|晚点|再往后|推后|稍晚|更晚|后[一点些]|推迟一下/;
// 提前/调早：再早一点、早一点、早点、再往前
const ADJUST_EARLIER_WORDS = /再早|早[一点些]|早点|再往前|提前一下|更早|前[一点些]/;

export interface ContextualRouteOptions {
  /** 当前存在 pending 状态的 confirmation ID */
  pendingConfirmationId?: string;
  /** 当前存在 pending clarification（等待用户补充信息） */
  pendingClarification?: boolean;
}

/**
 * 高确定性上下文预路由器。
 * - 空输入 / 纯标点 / 长度 ≤ 1 → low_signal
 * - pendingConfirmationId 存在且输入为确认词 → time_management + pendingAction.confirm
 * - pendingConfirmationId 存在且输入为拒绝词 → time_management + pendingAction.reject
 * - pendingClarification 存在且输入较短 → time_management（补充信息）
 * - 其余 → null（交给 LLM 分类器）
 */
export class ContextualPreRouter {
  classify(
    rawInput: string,
    options: ContextualRouteOptions = {}
  ): AgentRouteResult | null {
    const input = rawInput.trim();

    // ── 1. 空输入 / 纯标点 / 极短输入 ────────────────────────────────────────
    if (!input || input.length <= 1 || PURE_NOISE_PATTERN.test(input)) {
      // 即使有 pending 状态，极短纯噪声也路由到 low_signal
      // 防止 "？" 被误当作拒绝
      if (!(options.pendingConfirmationId && (CONFIRM_WORDS.test(input) || REJECT_WORDS.test(input)))) {
        return {
          domain: "low_signal",
          confidence: 0.95,
          matchedRule: "contextual_noise",
          rawInput,
          routerSource: "contextual",
        };
      }
    }

    // ── 2. Pending Confirmation 快捷路径 ─────────────────────────────────────
    const { pendingConfirmationId } = options;
    if (pendingConfirmationId) {
      if (CONFIRM_WORDS.test(input)) {
        return {
          domain: "time_management",
          confidence: 1.0,
          matchedRule: "contextual_pending_confirm",
          rawInput,
          routerSource: "contextual",
          pendingAction: { kind: "confirm", confirmationId: pendingConfirmationId },
        };
      }
      if (REJECT_WORDS.test(input)) {
        return {
          domain: "time_management",
          confidence: 1.0,
          matchedRule: "contextual_pending_reject",
          rawInput,
          routerSource: "contextual",
          pendingAction: { kind: "reject", confirmationId: pendingConfirmationId },
        };
      }
      // 时间调整：用户想把推荐时间调后或调前
      if (ADJUST_LATER_WORDS.test(input)) {
        return {
          domain: "time_management",
          confidence: 0.95,
          matchedRule: "contextual_pending_adjust_later",
          rawInput,
          routerSource: "contextual",
          pendingAction: { kind: "adjust_later", confirmationId: pendingConfirmationId },
        };
      }
      if (ADJUST_EARLIER_WORDS.test(input)) {
        return {
          domain: "time_management",
          confidence: 0.95,
          matchedRule: "contextual_pending_adjust_earlier",
          rawInput,
          routerSource: "contextual",
          pendingAction: { kind: "adjust_earlier", confirmationId: pendingConfirmationId },
        };
      }
    }

    // ── 3. Pending Clarification 补充信息 ─────────────────────────────────────
    if (options.pendingClarification && input.length <= 30) {
      return {
        domain: "time_management",
        confidence: 0.85,
        matchedRule: "contextual_pending_clarify",
        rawInput,
        routerSource: "contextual",
      };
    }

    // 未命中，交给下一级
    return null;
  }
}
