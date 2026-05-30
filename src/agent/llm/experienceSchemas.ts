// ============================================================
// experienceSchemas.ts — V3.7 LLMExperiencePlanResponse schema
//
// 与 V3.5 的 LLMResponseSchema 的区别：
// - kind 直接对应 ExperienceActionPlan.kind（减少转换层）
// - userGoal 对应 SemanticUserGoal
// - 新增 actions[] 字段，batch_action / defer_task 时必填
// - 不再有 intent 字段（由 userGoal 替代）
// ============================================================

import { z } from "zod";
import { extractJSON } from "@/agent/llm/schemas";

// ─── SinglePlanAction schema ──────────────────────────────────────────────────

export const SinglePlanActionSchema = z.object({
  toolName: z.string(),
  params: z.record(z.unknown()).default({}),
  summary: z.string().optional(),
});

// ─── ExperiencePlan kind ──────────────────────────────────────────────────────

export const ExperiencePlanKindSchema = z.enum([
  "tool",
  "query_schedule",
  "request_recommendation",
  "batch_action",
  "defer_task",
  "direct_response",
  "chat",
  "clarification",
  "unsupported",
]);

// ─── SemanticUserGoal schema ──────────────────────────────────────────────────

export const SemanticUserGoalSchema = z.enum([
  "ask_current_time",
  "create_and_schedule_task",
  "create_reminder",
  "delete_task",
  "query_schedule",
  "general_chat",
  "unsupported_intent",
  "query_schedule_range",
  "batch_delete_tasks",
  "batch_reschedule_day",
  "defer_task",
]);

// ─── LLMExperiencePlanResponse schema ────────────────────────────────────────

/**
 * V3.7 LLM 输出的顶层响应 schema。
 * 直接对应 ExperienceActionPlan 结构，LLMExperiencePlanner 解析后只需
 * 少量字段映射即可构造 ExperienceActionPlan。
 */
export const LLMExperiencePlanResponseSchema = z.object({
  kind: ExperiencePlanKindSchema,
  userGoal: SemanticUserGoalSchema.default("general_chat"),
  toolName: z.string().nullable().default(null),
  params: z
    .record(z.unknown())
    .nullable()
    .default({})
    .transform((v) => v ?? {}),
  requiresConfirmation: z.boolean().default(false),
  riskLevel: z.enum(["safe", "confirm", "destructive"]).default("safe"),
  summary: z.string().default(""),
  clarifyingQuestion: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.8),
  actions: z.array(SinglePlanActionSchema).optional(),
});

export type LLMExperiencePlanResponse = z.infer<typeof LLMExperiencePlanResponseSchema>;

// ─── 解析函数 ─────────────────────────────────────────────────────────────────

/**
 * 从 LLM 返回的原始字符串中解析 LLMExperiencePlanResponse。
 * 复用 extractJSON，并用新 schema 校验。
 */
export function parseLLMExperienceResponse(
  raw: string
):
  | { success: true; data: LLMExperiencePlanResponse }
  | { success: false; error: string } {
  const parsed = extractJSON(raw);
  if (parsed === null) {
    return {
      success: false,
      error: `LLM 返回内容不是有效 JSON：${raw.slice(0, 200)}`,
    };
  }

  const result = LLMExperiencePlanResponseSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: `LLM 输出 schema 校验失败：${result.error.message}`,
    };
  }

  return { success: true, data: result.data };
}
