import type {
  AgentExperienceContext,
  AgentToolResult,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";
import {
  ResponseKinds,
  type ResponseKind as AbstractResponseKind,
} from "@/agent/schemas";
import type { TimeBlock } from "@/types/timeblock.types";
import {
  renderResponse,
  type RendererOutput,
} from "@/agent/experience/responseRenderers";

/**
 * Local renderer branch labels. These remain intentionally more specific than
 * the product-level 8-value ResponseKind and are emitted as responseBranch.
 */
export type ResponseKind =
  | "greeting"
  | "ask_assistant_identity"
  | "ask_current_time"
  | "general_chat"
  | "general"
  | "knowledge_no_source"
  | "writing_assist"
  | "external_info_no_tool"
  | "feedback"
  | "low_signal"
  | "meta_identity"
  | "unsupported_intent"
  | "clarification"
  | "reminder_created"
  | "tool_success"
  | "tool_failure"
  | "verification_failed"
  | "confirmation_required"
  | "confirmation_missing"
  | "confirmation_stale"
  | "confirmation_rejected"
  | "query_result"
  | "recent_action"
  | "clarification_past_time";

export interface ComposeResponseArgs {
  context: AgentExperienceContext;
  frame: SemanticFrame;
  plan: ExperienceActionPlan;
  toolResults: AgentToolResult[];
  queryBlocks?: TimeBlock[];
  responseKind?: ResponseKind | AbstractResponseKind;
  responseBranch?: string;
  queryTasks?: Array<{ title: string; status: string }>;
  recentActions?: Array<{ summary: string; source: string }>;
  blocked?: { guardrailName: string; reason?: string; nextStep?: string };
  message?: string;
}

const LOCAL_RESPONSE_KINDS = new Set<ResponseKind>([
  "greeting",
  "ask_assistant_identity",
  "ask_current_time",
  "general_chat",
  "general",
  "knowledge_no_source",
  "writing_assist",
  "external_info_no_tool",
  "feedback",
  "low_signal",
  "meta_identity",
  "unsupported_intent",
  "clarification",
  "reminder_created",
  "tool_success",
  "tool_failure",
  "verification_failed",
  "confirmation_required",
  "confirmation_missing",
  "confirmation_stale",
  "confirmation_rejected",
  "query_result",
  "recent_action",
  "clarification_past_time",
]);

export class ResponseComposer {
  compose(args: ComposeResponseArgs): RendererOutput {
    const inferredBranch = this.inferResponseKind(
      args.frame,
      args.toolResults
    );
    const explicitKind = args.responseKind;
    const branchLabel =
      args.responseBranch ??
      (this.isLocalResponseKind(explicitKind)
        ? explicitKind
        : this.defaultBranchForAbstractKind(explicitKind, inferredBranch));
    const abstractKind = this.isAbstractResponseKind(explicitKind)
      ? explicitKind
      : this.mapToAbstractResponseKind(branchLabel as ResponseKind);

    return renderResponse(abstractKind, {
      context: args.context,
      frame: args.frame,
      plan: args.plan,
      toolResults: args.toolResults,
      queryBlocks: args.queryBlocks,
      queryTasks: args.queryTasks,
      recentActions: args.recentActions,
      blocked: args.blocked,
      explicitMessage: args.message,
      branchLabel,
    });
  }

  /** @deprecated Use compose() and consume RendererOutput. */
  composeMessage(args: ComposeResponseArgs): string {
    return this.compose(args).message;
  }

  inferResponseKind(
    frame: SemanticFrame,
    toolResults: AgentToolResult[]
  ): ResponseKind {
    if (
      frame.userGoal === "recent_action_query" ||
      frame.userGoal === "query_recent_action"
    ) {
      return "recent_action";
    }
    if (
      frame.userGoal === "query_tasks" ||
      frame.userGoal === "query_scheduled_tasks" ||
      frame.userGoal === "query_completed_tasks" ||
      frame.userGoal === "query_current_focus" ||
      frame.userGoal === "query_task_schedule_status" ||
      frame.userGoal === "query_tomorrow_schedule" ||
      frame.userGoal === "query_today_schedule" ||
      frame.userGoal === "query_schedule" ||
      frame.userGoal === "query_schedule_range"
    ) {
      return "query_result";
    }
    if (
      frame.userGoal === "ask_current_time" ||
      frame.userGoal === "general_chat" ||
      frame.userGoal === "unsupported_intent"
    ) {
      return frame.userGoal;
    }
    if (frame.userGoal === "request_advice") return "general_chat";

    const result = toolResults[0];
    if (result && !result.success) return "tool_failure";
    return "tool_success";
  }

  mapToAbstractResponseKind(local: ResponseKind): AbstractResponseKind {
    switch (local) {
      case "query_result":
        return ResponseKinds.QUERY_RESULT;
      case "recent_action":
        return ResponseKinds.RECENT_ACTION;
      case "clarification_past_time":
      case "clarification":
        return ResponseKinds.CLARIFICATION;
      case "confirmation_required":
      case "confirmation_missing":
      case "confirmation_stale":
      case "confirmation_rejected":
        return ResponseKinds.CONFIRMATION;
      case "tool_success":
      case "reminder_created":
        return ResponseKinds.ACTION_SUCCESS;
      case "tool_failure":
      case "verification_failed":
      case "external_info_no_tool":
        return ResponseKinds.ERROR;
      default:
        return ResponseKinds.SUGGESTION;
    }
  }

  private isLocalResponseKind(value: unknown): value is ResponseKind {
    return LOCAL_RESPONSE_KINDS.has(value as ResponseKind);
  }

  private isAbstractResponseKind(value: unknown): value is AbstractResponseKind {
    return Object.values(ResponseKinds).includes(
      value as AbstractResponseKind
    );
  }

  private defaultBranchForAbstractKind(
    kind: AbstractResponseKind | ResponseKind | undefined,
    inferred: ResponseKind
  ): string {
    switch (kind) {
      case ResponseKinds.ACTION_SUCCESS:
        return "tool_success";
      case ResponseKinds.CLARIFICATION:
        return "clarification";
      case ResponseKinds.CONFIRMATION:
        return "confirmation_required";
      case ResponseKinds.BLOCKED:
        return "blocked";
      case ResponseKinds.ERROR:
        return inferred === "tool_failure" ? inferred : "error_fallback";
      case ResponseKinds.SUGGESTION:
        return inferred;
      default:
        return inferred;
    }
  }
}
