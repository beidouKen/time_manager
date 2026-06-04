// ============================================================
// pastTimeDisambiguationGuard.ts — V3.8+ 确定性 Past Time Disambiguation Guard
//
// 职责：
//   保证"用户明确说了今天"、"补记语义"等 Past Time Disambiguation 规则
//   在 LLM 路径和规则路径下都生效。
//
//   调用时机：TimeManagementAgent.handle() 获取 actionPlan 后，在读取
//   allowShiftToNextDay / allowPastTime 之前，对 request_recommendation 类
//   plan 应用此 guard。
//
// 优先级：
//   frame.isExplicitToday（SemanticFrameParser 已填充）
//   > userInput 正则检测（防御性兜底，用于 LLM 产生的 frame 缺少字段时）
// ============================================================

import type { SemanticFrame } from "@/agent/types";

// ── 与 SemanticFrameParser 相同的正则（保持同步） ──────────────────────────
const EXPLICIT_TODAY_RE = /今天|今晚|今早/u;
const EXPLICIT_TOMORROW_RE = /明天/u;
const BACKFILL_RE =
  /补上|补记|记录一下|记一下|记上|刚才|刚刚|已经.*做|已经.*完成|之前做|先前做|做完了|完成了/u;

/**
 * 对 request_recommendation 类 plan 的 params 应用 Past Time Disambiguation 规则。
 *
 * 如果 ActionPlanner（规则路径）已经填充了 `allowShiftToNextDay`，则跳过（幂等）。
 * 如果 LLMExperiencePlanner 产生的 plan 缺少这些字段，则从 `frame` 或 `userInput` 推断。
 *
 * **直接 mutate params**，与 TimeManagementAgent 中其他对 actionPlan.params 的写法一致。
 */
export function applyPastTimeDisambiguationGuard(
  params: Record<string, unknown>,
  frame: SemanticFrame,
  userInput: string
): void {
  // 幂等：规则路径已设置时跳过（undefined 说明来自 LLM，需要填充）
  if (params.allowShiftToNextDay !== undefined) return;

  // 优先使用 SemanticFrameParser 填充的字段；
  // 若 frame 来自 LLM 没有这些字段（undefined），则降级到 userInput 正则检测
  const isExplicitToday =
    frame.isExplicitToday !== undefined
      ? Boolean(frame.isExplicitToday)
      : EXPLICIT_TODAY_RE.test(userInput) && !EXPLICIT_TOMORROW_RE.test(userInput);

  const isExplicitTomorrow =
    frame.explicitDateAnchor !== undefined
      ? frame.explicitDateAnchor === "tomorrow"
      : EXPLICIT_TOMORROW_RE.test(userInput);

  const possibleBackfill =
    frame.possibleBackfill !== undefined
      ? Boolean(frame.possibleBackfill)
      : BACKFILL_RE.test(userInput);

  // 优先级：明确日期 > 时段，只有无明确日期时才允许顺延
  const allowShiftToNextDay = !isExplicitToday && !isExplicitTomorrow;
  // 补记模式：忽略 now 过滤，可推荐已过去的时段
  const allowPastTime = possibleBackfill && isExplicitToday;
  const dateOffsetDays = isExplicitTomorrow ? 1 : 0;

  Object.assign(params, {
    allowShiftToNextDay,
    allowPastTime,
    possibleBackfill,
    isExplicitToday,
    dateOffsetDays,
  });
}
