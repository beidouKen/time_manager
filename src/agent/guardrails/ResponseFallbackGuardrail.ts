import { ResponseComposer } from "@/agent/experience/ResponseComposer";
import { ResponseKinds } from "@/agent/schemas";
import type {
  Guardrail,
  GuardrailContext,
  GuardrailResult,
} from "@/agent/guardrails/Guardrail";

const QUERY_GOALS = new Set([
  "ask_current_time",
  "query_schedule",
  "query_schedule_range",
  "query_tasks",
  "query_today_schedule",
  "recent_action_query",
  "request_advice",
  "query_scheduled_tasks",
  "query_completed_tasks",
  "query_current_focus",
  "query_task_schedule_status",
  "query_tomorrow_schedule",
  "query_recent_action",
]);

export class ResponseFallbackGuardrail implements Guardrail {
  readonly name = "ResponseFallbackGuardrail";
  readonly stage = "post_response" as const;
  private readonly composer = new ResponseComposer();

  check(ctx: GuardrailContext): GuardrailResult {
    const userGoal =
      ctx.semanticFrame?.userGoal ??
      ctx.plan?.userGoal;
    const localKind = ctx.responseKind;
    const abstractKind = toAbstractKind(this.composer, localKind);
    const responseMessage = ctx.responseMessage ?? "";
    const responseBranch = ctx.metadata?.responseBranch;
    const genericFallbackUsed =
      ctx.metadata?.genericFallbackUsed === true;
    const evidence = {
      userGoal: userGoal ?? null,
      localKind: localKind ?? null,
      abstractKind: abstractKind ?? null,
      responseBranch: responseBranch ?? null,
      genericFallbackUsed,
    };

    if (
      genericFallbackUsed &&
      abstractKind !== ResponseKinds.ERROR &&
      abstractKind !== ResponseKinds.SUGGESTION &&
      responseBranch !== "error_fallback"
    ) {
      return {
        pass: false,
        decision: "block",
        reason: "generic_fallback_for_non_error",
        evidence,
      };
    }

    if (
      userGoal &&
      QUERY_GOALS.has(userGoal) &&
      abstractKind === ResponseKinds.ACTION_SUCCESS
    ) {
      return {
        pass: false,
        decision: "block",
        reason: "query_response_misclassified_as_action_success",
        evidence,
      };
    }

    if (
      userGoal &&
      QUERY_GOALS.has(userGoal) &&
      responseMessage.includes("已处理完成")
    ) {
      return {
        pass: false,
        decision: "block",
        reason: "generic_action_success_for_query",
        evidence,
      };
    }

    const priorBlocked = ctx.priorGuardrailResults?.some(
      (result) => result.decision !== "allow"
    );
    if (priorBlocked) {
      const toolName = ctx.plan?.toolName ?? ctx.metadata?.toolName;
      const leaksJson = responseMessage.includes("{");
      const leaksToolName =
        Boolean(toolName) && responseMessage.includes(String(toolName));
      if (leaksJson || leaksToolName) {
        return {
          pass: false,
          decision: "block",
          reason: "guardrail_context_leak",
          evidence: {
            ...evidence,
            leaksJson,
            leaksToolName,
            toolName: toolName ?? null,
          },
        };
      }
    }

    return {
      pass: true,
      decision: "allow",
      evidence,
    };
  }
}

function toAbstractKind(
  composer: ResponseComposer,
  kind: string | undefined
): string | undefined {
  if (!kind) return undefined;
  if (Object.values(ResponseKinds).includes(
    kind as (typeof ResponseKinds)[keyof typeof ResponseKinds]
  )) {
    return kind;
  }
  return composer.mapToAbstractResponseKind(
    kind as import("@/agent/experience/ResponseComposer").ResponseKind
  );
}
