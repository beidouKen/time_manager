// ============================================================
// PlanSafetyValidator — V3.7 统一安全闸门
//
// 职责：
// 1. 验证 ExperienceActionPlan 的结构正确性
// 2. 强制 destructive 操作必须经过确认（不信任 planner 输出）
// 3. riskLevel 与 CONFIRMATION_POLICY 取最大值
// 4. batch_action / defer_task 必须携带 actions[]
// 5. LLM 和 rule planner 输出都必须经过此验证器
//
// 注意：
// - 本验证器只决定计划是否合法，不执行工具
// - 最终的风险判断权在代码层（本文件），不在 LLM / Planner
// ============================================================

import type { ExperienceActionPlan } from "@/agent/types";
import { CONFIRMATION_POLICY } from "@/agent/types";
import type { ToolRouter } from "@/agent/ToolRouter";

export type PlanSafetyResult =
  | { ok: true; plan: ExperienceActionPlan }
  | { ok: false; reason: string; errorKind: "invalid_tool" | "policy_upgraded" | "missing_actions" | "invalid_plan" };

/**
 * 风险等级数值，用于取最大值。
 */
const RISK_ORDER = { safe: 0, confirm: 1, destructive: 2 } as const;

function maxRisk(
  a: ExperienceActionPlan["riskLevel"],
  b: ExperienceActionPlan["riskLevel"]
): ExperienceActionPlan["riskLevel"] {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export class PlanSafetyValidator {
  constructor(private router: ToolRouter) {}

  validate(plan: ExperienceActionPlan): PlanSafetyResult {
    // 1. kind=tool 时，toolName 必须在注册表中存在
    if (plan.kind === "tool") {
      if (!plan.toolName) {
        return {
          ok: false,
          reason: "kind=tool 但 toolName 为空",
          errorKind: "invalid_plan",
        };
      }
      if (!this.router.getTool(plan.toolName)) {
        return {
          ok: false,
          reason: `toolName "${plan.toolName}" 未在 ToolRouter 中注册`,
          errorKind: "invalid_tool",
        };
      }
    }

    // 2. batch_action / defer_task 必须携带 actions 字段（可以为空数组，空则 confirm 后无操作）
    if (plan.kind === "batch_action" || plan.kind === "defer_task") {
      const actions = plan.params.actions as unknown[] | undefined;
      if (!Array.isArray(actions)) {
        return {
          ok: false,
          reason: `kind=${plan.kind} 但 params.actions 未定义，无法执行`,
          errorKind: "missing_actions",
        };
      }
    }

    // 3. 强制 destructive：CONFIRMATION_POLICY 中风险为 destructive 的 intent 必须确认
    let effectivePlan = plan;

    if (plan.kind === "tool" && plan.toolName) {
      // 用 toolName 作为 intent 查 policy（toolName 与 IntentType 约定一致）
      const policyRisk =
        CONFIRMATION_POLICY[plan.toolName as keyof typeof CONFIRMATION_POLICY] ?? "safe";
      const finalRisk = maxRisk(plan.riskLevel, policyRisk);

      const toolRequiresConfirm = this.router.hasToolRequiringConfirmation(plan.toolName);
      const requiresConfirmation =
        plan.requiresConfirmation ||
        toolRequiresConfirm ||
        finalRisk === "destructive";

      if (requiresConfirmation !== plan.requiresConfirmation || finalRisk !== plan.riskLevel) {
        effectivePlan = {
          ...plan,
          requiresConfirmation,
          riskLevel: finalRisk,
        };
      }
    }

    // 4. batch_action / defer_task 始终高风险，必须确认
    if (plan.kind === "batch_action" || plan.kind === "defer_task") {
      const finalRisk = maxRisk(plan.riskLevel, "confirm");
      effectivePlan = {
        ...effectivePlan,
        requiresConfirmation: true,
        riskLevel: finalRisk,
      };
    }

    return { ok: true, plan: effectivePlan };
  }
}
