import type {
  Guardrail,
  GuardrailContext,
  GuardrailResult,
} from "@/agent/guardrails/Guardrail";

const QUERY_USER_GOALS = new Set([
  "query_tasks",
  "query_schedule",
  "recent_action_query",
  "query_current_focus",
  "request_advice",
  "ask_current_time",
]);

export class ReadWriteBoundaryGuardrail implements Guardrail {
  readonly name = "ReadWriteBoundaryGuardrail";
  readonly stage = "pre_tool" as const;

  check(ctx: GuardrailContext): GuardrailResult {
    const { toolName, toolManifest } = ctx;
    if (!toolName || !toolManifest) {
      return {
        pass: false,
        decision: "block",
        reason: "missing_required_ctx",
        evidence: {
          toolName: toolName ?? null,
          hasToolManifest: Boolean(toolManifest),
        },
      };
    }

    const userGoal =
      ctx.semanticFrame?.userGoal ??
      ctx.plan?.userGoal;

    if (
      toolManifest.readOnly &&
      toolManifest.businessSideEffects.length > 0
    ) {
      return {
        pass: false,
        decision: "block",
        reason: "invalid_readonly_manifest",
        evidence: {
          userGoal: userGoal ?? null,
          toolName,
          readOnly: true,
          businessSideEffects: toolManifest.businessSideEffects,
        },
      };
    }

    if (
      userGoal &&
      QUERY_USER_GOALS.has(userGoal) &&
      !toolManifest.readOnly
    ) {
      return {
        pass: false,
        decision: "block",
        reason: "query_intent_cannot_use_write_tool",
        evidence: {
          userGoal,
          toolName,
          readOnly: false,
          businessSideEffects: toolManifest.businessSideEffects,
        },
      };
    }

    return {
      pass: true,
      decision: "allow",
      evidence: {
        userGoal: userGoal ?? null,
        toolName,
        readOnly: toolManifest.readOnly,
        businessSideEffects: toolManifest.businessSideEffects,
      },
    };
  }
}
