// ============================================================
// ContextualPreRouter — V3.7 P1 / V3.8
//
// 路由器 Stage 1：处理高确定性状态，不调 LLM。
// 返回 null 表示未命中，由后续路由段继续处理。
//
// V3.8 变更：移除 ADJUST_LATER/EARLIER_WORDS 正则块，
// 时间调整类细化统一交给 Stage 2 PendingProposalInterpreter 处理。
// Stage 1 只保留精确 confirm/reject 作为零延迟快捷路径。
// ============================================================

import type { AgentRouteResult, PendingProposalSnapshot } from "@/agent/types";

const PURE_NOISE_PATTERN = /^[\s\p{P}\p{S}]*$/u;

const CONFIRM_WORDS =
  /^(好|确认|可以|yes|ok|y|对|嗯|行|没问题|好的|同意|确定)[！!。.，,\s]*$/iu;

/**
 * V3.8+: "更改为 X 分钟 / 改成半小时 / 时长调整为 ..." 这类纯时长调整短句。
 * 没有 pendingProposal 时，LLM 容易把它误判为闲聊，因此在 Stage 1 给一个
 * 高置信度的快捷通道，直接路由到 time_management 让 ActionPlanner 处理。
 */
// 中文字符无法被 JS `\b` 识别，所以这里用 `[！!。.，,\s]*$` 收尾或允许后续无字符。
const DURATION_TWEAK_PATTERN =
  /^(把?(刚才|刚刚|那个|这个|它))?\s*(更改|改|调整|修改)\s*(为|成|到|至)?\s*(\d+\s*(分钟|分|min|小时|h)|半小时|半个小时|一刻钟|一个半小时)[！!。.，,\s]*$|^时长\s*(更改|改|调整|修改)/iu;

// C2/G13: 宽松拒绝词——前缀词 + 容许常见语气后缀（了/吧/啦/的）
export const REJECT_WORDS =
  /^(取消|不要|不用|不用了|算了|放弃|拒绝)(了|吧|啦|的)?[！!。.，,\s]*$/iu;
// 严格单字拒绝词（"不"/"no"/"n" 单独出现）——避免 "不知道"、"不行" 误命中
export const REJECT_WORDS_STRICT = /^(不|no|n)[！!。.，,\s]*$/iu;

export interface ContextualRouteOptions {
  /** 当前存在 pending 状态的 confirmation ID（任意类型） */
  pendingConfirmationId?: string;
  /** 当前存在 pending clarification（等待用户补充信息） */
  pendingClarification?: boolean;
  /**
   * V3.8: 当前存在的推荐类待确认提案快照。
   * 若存在，Stage 1 跳过 clarification 短路，把决策权交给 Stage 2
   * PendingProposalInterpreter（它能精细识别 refine / topic_change）。
   */
  pendingProposal?: PendingProposalSnapshot;
}

/**
 * 高确定性上下文预路由器（Stage 1）。
 * - 空输入 / 纯标点 / 长度 ≤ 1 → low_signal
 * - pendingConfirmationId 存在且输入为精确确认词 → pendingAction.confirm
 * - pendingConfirmationId 存在且输入为精确拒绝词 → pendingAction.reject
 * - pendingClarification 存在且输入较短 → time_management（补充信息）
 * - 其余（包括"再晚一点""时间大概一小时"等模糊细化）→ null，
 *   由 Stage 2 PendingProposalInterpreter 或 Stage 3 LLMDomainClassifier 处理
 */
export class ContextualPreRouter {
  classify(
    rawInput: string,
    options: ContextualRouteOptions = {}
  ): AgentRouteResult | null {
    const input = rawInput.trim();

    // ── 1. 空输入 / 纯标点 / 极短输入 ─────────────────────────────────────────
    if (!input || input.length <= 1 || PURE_NOISE_PATTERN.test(input)) {
      // 极短纯噪声路由到 low_signal，即使有 pending 状态也不误触确认/拒绝
      if (
        !(
          options.pendingConfirmationId &&
          (CONFIRM_WORDS.test(input) || REJECT_WORDS_STRICT.test(input) || REJECT_WORDS.test(input))
        )
      ) {
        return {
          domain: "low_signal",
          confidence: 0.95,
          matchedRule: "contextual_noise",
          rawInput,
          routerSource: "contextual",
        };
      }
    }

    // ── 2. Pending Confirmation 精确快捷路径 ───────────────────────────────────
    // 只处理高确定性的确认/拒绝词；模糊细化（"再晚一点"等）交给 Stage 2。
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
      if (REJECT_WORDS_STRICT.test(input) || REJECT_WORDS.test(input)) {
        return {
          domain: "time_management",
          confidence: 1.0,
          matchedRule: "contextual_pending_reject",
          rawInput,
          routerSource: "contextual",
          pendingAction: { kind: "reject", confirmationId: pendingConfirmationId },
        };
      }
    }

    // ── 2.5. 高确定性时长调整快捷通道 ───────────────────────────────────────
    // "更改为15分钟" / "改成半小时" 这类输入在没有 pendingProposal 时容易被
    // LLM 误判为 general_chat。直接路由到 time_management，由 ActionPlanner
    // 的 update_recent_duration 分支决定是改写最近时间块还是追问澄清。
    // 仅在 *不存在* recommendation 类提案时介入，避免抢走 Stage 2 的 refine 路径。
    if (
      !options.pendingProposal &&
      DURATION_TWEAK_PATTERN.test(input)
    ) {
      return {
        domain: "time_management",
        confidence: 0.9,
        matchedRule: "contextual_duration_tweak",
        rawInput,
        routerSource: "contextual",
      };
    }

    // ── 3. Pending Clarification 补充信息（非 recommendation 类提案） ──────────
    // pendingClarification && 输入较短 → 直接路由到 time_management，
    // 让 TimeManagementAgent 在原始框架内处理（query 补充等场景）。
    //
    // V3.8 修复：若同时存在 recommendation 类 pendingProposal，必须**跳过**
    // 本短路，让 Stage 2 PendingProposalInterpreter 接管细化识别。
    // 否则像 "时间大概为45分钟"、"再晚一点" 等会被错当成新的 time_management
    // 请求，丢掉提案上下文。
    if (
      options.pendingClarification &&
      input.length <= 30 &&
      options.pendingProposal?.kind !== "recommendation"
    ) {
      return {
        domain: "time_management",
        confidence: 0.85,
        matchedRule: "contextual_pending_clarify",
        rawInput,
        routerSource: "contextual",
      };
    }

    // 未命中，交给 Stage 2 / Stage 3
    return null;
  }
}
