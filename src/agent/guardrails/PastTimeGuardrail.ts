import type {
  Guardrail,
  GuardrailContext,
  GuardrailResult,
} from "@/agent/guardrails/Guardrail";

const TIME_WRITE_TOOLS = new Set([
  "create_time_block",
  "update_time_block",
  "schedule_task",
  "bind_task_to_time_block",
]);

const START_TIME_KEYS = [
  "start_time",
  "start_iso",
  "startAt",
  "startTime",
  "startISO",
] as const;

export class PastTimeGuardrail implements Guardrail {
  readonly name = "PastTimeGuardrail";
  readonly stage = "pre_tool" as const;

  check(ctx: GuardrailContext): GuardrailResult {
    const params = ctx.toolParams ?? ctx.plan?.params ?? {};
    const startIso = findStartIso(params);
    if (!startIso) {
      return {
        pass: true,
        decision: "allow",
        evidence: {
          toolName: ctx.toolName ?? null,
          startIso: null,
        },
      };
    }

    if (
      !ctx.toolName ||
      (!TIME_WRITE_TOOLS.has(ctx.toolName) && ctx.toolManifest?.readOnly)
    ) {
      return {
        pass: true,
        decision: "allow",
        evidence: {
          toolName: ctx.toolName ?? null,
          startIso,
          skipped: "not_time_write_tool",
        },
      };
    }

    if (!(ctx.now instanceof Date) || Number.isNaN(ctx.now.getTime())) {
      return {
        pass: false,
        decision: "ask_clarification",
        reason: "missing_required_ctx",
        evidence: {
          toolName: ctx.toolName,
          startIso,
          nowIso: null,
        },
      };
    }

    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) {
      return {
        pass: false,
        decision: "ask_clarification",
        reason: "invalid_start_time",
        evidence: {
          toolName: ctx.toolName,
          startIso,
          nowIso: ctx.now.toISOString(),
        },
      };
    }

    const semanticType = String(
      ctx.semanticFrame?.constraints?.semanticType ??
      params.semanticType ??
      ""
    );
    const backfillAcknowledged =
      semanticType === "backfill" ||
      params.semanticType === "backfill" ||
      ctx.semanticFrame?.constraints?.allowPastTime === true ||
      ctx.semanticFrame?.possibleBackfill === true ||
      params.allowPastTime === true;

    if (backfillAcknowledged) {
      return {
        pass: true,
        decision: "allow",
        evidence: {
          toolName: ctx.toolName,
          startIso,
          nowIso: ctx.now.toISOString(),
          semanticType: semanticType || null,
          backfillAcknowledged: true,
        },
      };
    }

    if (start.getTime() < ctx.now.getTime()) {
      return {
        pass: false,
        decision: "ask_clarification",
        reason: "past_time_requires_clarification",
        evidence: {
          toolName: ctx.toolName,
          startIso,
          nowIso: ctx.now.toISOString(),
          semanticType: semanticType || null,
        },
      };
    }

    return {
      pass: true,
      decision: "allow",
      evidence: {
        toolName: ctx.toolName,
        startIso,
        nowIso: ctx.now.toISOString(),
        semanticType: semanticType || null,
      },
    };
  }
}

function findStartIso(params: Record<string, unknown>): string | undefined {
  for (const key of START_TIME_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}
