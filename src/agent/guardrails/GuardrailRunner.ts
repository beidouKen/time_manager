import type {
  Guardrail,
  GuardrailContext,
  GuardrailDecision,
  GuardrailRunReport,
  GuardrailRunResult,
  GuardrailStage,
} from "@/agent/guardrails/Guardrail";

const DECISION_SEVERITY: Record<GuardrailDecision, number> = {
  allow: 0,
  ask_confirmation: 1,
  ask_clarification: 2,
  block: 3,
};

export class GuardrailRunner {
  private readonly guardrails: Guardrail[] = [];

  register(guardrail: Guardrail): void {
    this.guardrails.push(guardrail);
  }

  list(stage: GuardrailStage): Guardrail[] {
    return this.guardrails.filter((guardrail) => guardrail.stage === stage);
  }

  async runAll(
    stage: GuardrailStage,
    ctx: GuardrailContext
  ): Promise<GuardrailRunReport> {
    const results: GuardrailRunResult[] = [];
    let finalDecision: GuardrailDecision = "allow";

    for (const guardrail of this.list(stage)) {
      const startedAt = performance.now();
      let result: GuardrailRunResult;

      try {
        const checked = await Promise.resolve(
          guardrail.check({ ...ctx, stage })
        );
        result = {
          name: guardrail.name,
          decision: checked.decision,
          reason: checked.reason,
          evidence: checked.evidence,
          latencyMs: performance.now() - startedAt,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          name: guardrail.name,
          decision: "block",
          reason: `guardrail_exception: ${message}`,
          latencyMs: performance.now() - startedAt,
        };
      }

      results.push(result);
      if (
        DECISION_SEVERITY[result.decision] >
        DECISION_SEVERITY[finalDecision]
      ) {
        finalDecision = result.decision;
      }

      if (result.decision === "block") {
        return {
          stage,
          results,
          finalDecision: "block",
          firstBlocker: guardrail.name,
        };
      }
    }

    return {
      stage,
      results,
      finalDecision,
    };
  }
}
