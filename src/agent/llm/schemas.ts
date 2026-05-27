// ============================================================
// schemas.ts — LLM 输出结构的 Zod schema（运行时校验）
//
// LLM 必须输出严格 JSON，该 schema 用于：
// 1. 在 LLMPlanner 中对 LLM 原始输出做 safeParse
// 2. 类型推导，为后续安全校验提供强类型
// ============================================================

import { z } from "zod";

/**
 * LLM 可返回的意图类型。
 * 与 src/agent/types.ts 的 IntentType 保持一致（但允许 unknown）。
 */
export const LLMIntentSchema = z.enum([
  "create_task",
  "list_tasks",
  "update_task",
  "delete_task",
  "mark_task_completed",
  "create_time_block",
  "move_time_block",
  "delete_time_block",
  "list_time_blocks",
  "bind_task_to_time_block",
  "schedule_task",
  "reschedule_day",
  "detect_conflicts",
  "get_free_slots",
  "get_today_plan",
  "explain_task",
  "explain_schedule",
  "unknown",
]);

export type LLMIntent = z.infer<typeof LLMIntentSchema>;

/**
 * LLM 输出的顶层结构 schema。
 *
 * 字段说明：
 * - type:                 响应类型，决定后续处理路径
 * - intent:               用户意图（仅 type=tool_plan 时有意义）
 * - toolName:             要调用的工具名（仅 type=tool_plan 时有意义）
 * - params:               工具参数（仅 type=tool_plan 时有意义）
 * - requiresConfirmation: LLM 建议是否需要确认（代码层会二次覆盖危险操作）
 * - riskLevel:            LLM 评估的风险等级（代码层会以 CONFIRMATION_POLICY 覆盖）
 * - summary:              人类可读摘要（用于确认弹窗描述或 Chat 回复）
 * - clarifyingQuestion:   type=clarification 时的追问内容
 * - confidence:           置信度 0-1
 */
export const LLMResponseSchema = z.object({
  type: z.enum(["tool_plan", "clarification", "chitchat", "unsupported"]),
  intent: LLMIntentSchema.default("unknown"),
  toolName: z.string().nullable().default(null),
  params: z.record(z.unknown()).default({}),
  requiresConfirmation: z.boolean().default(false),
  riskLevel: z.enum(["safe", "confirm", "destructive"]).default("safe"),
  summary: z.string().default(""),
  clarifyingQuestion: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.8),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

/**
 * 从 LLM 返回的原始字符串中解析 JSON。
 *
 * 处理两种常见情况：
 * 1. 纯 JSON 字符串（符合预期）
 * 2. Markdown 代码块包裹的 JSON（如 ```json\n{...}\n```）
 *
 * 返回 null 表示解析失败。
 */
export function extractJSON(raw: string): unknown | null {
  const trimmed = raw.trim();

  // 尝试直接解析
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // 继续尝试剥离 Markdown 代码块
  }

  // 剥离 ```json ... ``` 或 ``` ... ```
  const codeBlockMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as unknown;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * 完整解析并校验 LLM 输出字符串。
 * 返回 { success: true, data } 或 { success: false, error }。
 */
export function parseLLMResponse(
  raw: string
): { success: true; data: LLMResponse } | { success: false; error: string } {
  const parsed = extractJSON(raw);
  if (parsed === null) {
    return {
      success: false,
      error: `LLM 返回内容不是有效 JSON：${raw.slice(0, 200)}`,
    };
  }

  const result = LLMResponseSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: `LLM 输出 schema 校验失败：${result.error.message}`,
    };
  }

  return { success: true, data: result.data };
}
