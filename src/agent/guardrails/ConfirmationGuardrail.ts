import {
  getHilPolicy,
  legacyHilDecision,
} from "@/agent/schemas";
import type { IntentType } from "@/agent/types";
import type {
  Guardrail,
  GuardrailContext,
  GuardrailResult,
} from "@/agent/guardrails/Guardrail";
import { mapUserGoalToIntent } from "@/agent/guardrails/intentMapping";

const BATCH_CONFIRMATION_THRESHOLD = 3;

export class ConfirmationGuardrail implements Guardrail {
  readonly name = "ConfirmationGuardrail";
  readonly stage = "pre_tool" as const;

  check(ctx: GuardrailContext): GuardrailResult {
    if (ctx.__confirmationId) {
      return {
        pass: true,
        decision: "allow",
        evidence: {
          source: "confirmed_replay",
          confirmationId: ctx.__confirmationId,
        },
      };
    }

    const { toolName, toolManifest } = ctx;
    if (!toolName || !toolManifest) {
      return {
        pass: false,
        decision: "block",
        reason: "missing_required_ctx",
        evidence: {
          source: "missing_required_ctx",
          toolName: toolName ?? null,
          hasToolManifest: Boolean(toolManifest),
        },
      };
    }

    const affectedCount = inferAffectedCount(ctx);
    if (toolManifest.requiresConfirmation) {
      return {
        pass: false,
        decision: "ask_confirmation",
        reason: "manifest_requires_confirmation",
        evidence: {
          source: "manifest",
          riskLevel: toolManifest.riskLevel,
          batchAware: toolManifest.batchAware,
          ...(affectedCount >= BATCH_CONFIRMATION_THRESHOLD
            ? {
                batch: {
                  affectedCount,
                  threshold: BATCH_CONFIRMATION_THRESHOLD,
                },
              }
            : {}),
        },
      };
    }

    const userGoal =
      ctx.semanticFrame?.userGoal ??
      ctx.plan?.userGoal;
    const intent = mapUserGoalToIntent(userGoal);
    if (intent) {
      const entry = getHilPolicy(intent);
      if (entry.requiresConfirmation) {
        return {
          pass: false,
          decision: "ask_confirmation",
          reason: "hil_policy_requires_confirmation",
          evidence: {
            source: "hil_matrix",
            intent,
            entry,
          },
        };
      }
    } else {
      const entry = legacyHilDecision(toolName as IntentType);
      if (entry.requiresConfirmation) {
        return {
          pass: false,
          decision: "ask_confirmation",
          reason: "legacy_policy_requires_confirmation",
          evidence: {
            source: "legacy_fallback",
            entry,
          },
        };
      }
    }

    if (
      toolManifest.batchAware &&
      affectedCount >= BATCH_CONFIRMATION_THRESHOLD
    ) {
      return {
        pass: false,
        decision: "ask_confirmation",
        reason: "batch_threshold_reached",
        evidence: {
          source: "batch",
          affectedCount,
          threshold: BATCH_CONFIRMATION_THRESHOLD,
        },
      };
    }

    return {
      pass: true,
      decision: "allow",
      evidence: {
        source: intent ? "hil_matrix" : "legacy_fallback",
        intent: intent ?? undefined,
        affectedCount,
      },
    };
  }
}

function inferAffectedCount(ctx: GuardrailContext): number {
  const params = ctx.toolParams ?? ctx.plan?.params ?? {};
  const explicitCount = params.affectedCount;
  if (
    typeof explicitCount === "number" &&
    Number.isFinite(explicitCount) &&
    explicitCount >= 0
  ) {
    return explicitCount;
  }

  const candidates = [
    params.taskIds,
    params.timeBlockIds,
    params.items,
    params.actions,
    ctx.plan?.actions,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
  }

  return 1;
}
