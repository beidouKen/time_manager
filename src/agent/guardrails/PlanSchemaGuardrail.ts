import type {
  Guardrail,
  GuardrailContext,
  GuardrailResult,
} from "@/agent/guardrails/Guardrail";
import type {
  PlanSafetyResult,
  PlanSafetyValidator,
} from "@/agent/validators/PlanSafetyValidator";

type PlanValidator = Pick<PlanSafetyValidator, "validate">;

export class PlanSchemaGuardrail implements Guardrail {
  readonly name = "PlanSchemaGuardrail";
  readonly stage = "post_plan" as const;

  constructor(private readonly validator: PlanValidator) {}

  check(ctx: GuardrailContext): GuardrailResult {
    const plan = ctx.rawPlan;
    if (!plan) {
      return {
        pass: false,
        decision: "block",
        reason: "missing_required_ctx",
        evidence: {
          errorKind: "missing_raw_plan",
        },
      };
    }

    if (plan.kind === "tool" && !plan.toolName) {
      return {
        pass: false,
        decision: "block",
        reason: "missing_tool_name",
        evidence: {
          errorKind: "missing_tool_name",
        },
      };
    }

    if (
      (plan.kind === "batch_action" || plan.kind === "defer_task") &&
      !Array.isArray(plan.actions) &&
      !Array.isArray(plan.params.actions)
    ) {
      return {
        pass: false,
        decision: "block",
        reason: "missing_actions",
        evidence: {
          errorKind: "missing_actions",
          planKind: plan.kind,
        },
      };
    }

    if (plan.kind === "clarification_past_time" && plan.toolName) {
      return {
        pass: false,
        decision: "block",
        reason: "clarification_plan_has_tool",
        evidence: {
          errorKind: "clarification_has_tool",
          toolName: plan.toolName,
        },
      };
    }

    const safetyResult: PlanSafetyResult = this.validator.validate(plan);
    if (!safetyResult.ok) {
      return {
        pass: false,
        decision: "block",
        reason: safetyResult.reason,
        evidence: {
          errorKind: safetyResult.errorKind,
        },
      };
    }

    return {
      pass: true,
      decision: "allow",
      evidence: {
        effectivePlan: safetyResult.plan,
        requiresConfirmation: safetyResult.plan.requiresConfirmation,
        riskLevel: safetyResult.plan.riskLevel,
      },
    };
  }
}
