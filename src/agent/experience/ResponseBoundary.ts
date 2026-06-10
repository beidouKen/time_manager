import {
  ResponseComposer,
  type ResponseKind,
} from "@/agent/experience/ResponseComposer";
import type { RendererOutput } from "@/agent/experience/responseRenderers";
import type {
  AgentExperienceContext,
  AgentHandlerResult,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";

export interface FinalizeInput {
  context: AgentExperienceContext;
  frame: SemanticFrame;
  plan: ExperienceActionPlan;
  result: AgentHandlerResult;
}

const INTERNAL_NAME_PATTERN =
  /\b(userGoal|processWith|ToolRouter|LLMPlanner|ActionPlanner|SemanticFrameParser|AgentDomainRouter|semantic_frame|request_recommendation|tool_success|tool_failure|confirmation_required|delete_task|create_reminder|create_and_schedule_task|query_schedule|ask_current_time|unsupported_intent|general_chat)\b/gi;

export class ResponseBoundary {
  private composer = new ResponseComposer();

  finalizeRich(input: FinalizeInput): RendererOutput {
    const rendered = this.composer.compose({
      context: input.context,
      frame: input.frame,
      plan: input.plan,
      toolResults: input.result.toolResults ?? [],
      queryBlocks: input.result.queryBlocks,
      queryTasks: input.result.queryTasks,
      recentActions: input.result.recentActions,
      blocked: input.result.blocked,
      responseKind: input.result.responseKind as
        | ResponseKind
        | import("@/agent/schemas").ResponseKind
        | undefined,
      responseBranch: input.result.responseBranch,
      message: input.result.message,
    });

    return {
      ...rendered,
      message: this.sanitize(rendered.message),
    };
  }

  finalize(input: FinalizeInput): string {
    return this.finalizeRich(input).message;
  }

  composeWithKind(_kind: ResponseKind, message: string): string {
    return this.sanitize(message);
  }

  private sanitize(message: string): string {
    let text = message.trim();

    const fencedJsonMatch = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
    if (fencedJsonMatch) {
      try {
        const parsed = JSON.parse(fencedJsonMatch[1]) as Record<string, unknown>;
        const extracted = parsed.message ?? parsed.reply ?? parsed.content;
        if (typeof extracted === "string" && extracted.trim()) {
          text = extracted.trim();
        }
      } catch {
        // Keep the original text when it is not valid JSON.
      }
    }

    if (text.startsWith("{") && text.endsWith("}")) {
      try {
        const parsed = JSON.parse(text) as { message?: unknown; reply?: unknown };
        const extracted = parsed.message ?? parsed.reply;
        if (typeof extracted === "string" && extracted.trim()) {
          text = extracted.trim();
        }
      } catch {
        // Keep the original text when it is not valid JSON.
      }
    }

    text = text.replace(INTERNAL_NAME_PATTERN, "").replace(/\s{2,}/g, " ").trim();
    return text.replace(/\n{3,}/g, "\n\n");
  }
}
