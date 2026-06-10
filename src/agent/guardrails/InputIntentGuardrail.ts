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
  "general_chat",
]);

const WRITE_VERB_RE =
  /(创建|新建|添加|安排|排到|修改|更新|调整|移动|延期|完成|删除|清空|归档|取消)/;
const DESTRUCTIVE_VERB_RE = /(删除|清空|全部移除|全删)/;

export class InputIntentGuardrail implements Guardrail {
  readonly name = "InputIntentGuardrail";
  readonly stage = "pre_plan" as const;

  check(ctx: GuardrailContext): GuardrailResult {
    const userGoal = ctx.semanticFrame?.userGoal;
    const rawInput = ctx.userInput ?? "";
    const commandText = rawInput.replace(/(?:未|已|没有)安排/g, "");
    const hasPendingProposal =
      ctx.workingMemoryPacket?.activeContextSummary.status ===
        "pending_proposal" ||
      Boolean(ctx.workingMemoryPacket?.activeContextSummary.proposal);

    if (
      (userGoal === "unsupported_intent" || !userGoal) &&
      DESTRUCTIVE_VERB_RE.test(rawInput)
    ) {
      return {
        pass: false,
        decision: "ask_clarification",
        reason: "destructive_low_signal",
        evidence: {
          userGoal: userGoal ?? "low_signal",
          destructiveSignal: true,
        },
      };
    }

    const softSignal =
      Boolean(userGoal && QUERY_GOALS.has(userGoal)) &&
      !WRITE_VERB_RE.test(commandText) &&
      !hasPendingProposal;

    return {
      pass: true,
      decision: "allow",
      evidence: {
        userGoal: userGoal ?? null,
        softSignal,
        hasPendingProposal,
      },
    };
  }
}
