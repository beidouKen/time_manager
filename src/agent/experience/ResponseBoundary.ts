import { ResponseComposer, type ResponseKind } from "@/agent/experience/ResponseComposer";
import type {
  AgentExperienceContext,
  AgentHandlerResult,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";

interface FinalizeInput {
  context: AgentExperienceContext;
  frame: SemanticFrame;
  plan: ExperienceActionPlan;
  result: AgentHandlerResult;
}

const INTERNAL_NAME_PATTERN =
  /\b(userGoal|processWith|ToolRouter|LLMPlanner|ActionPlanner|SemanticFrameParser|AgentDomainRouter|semantic_frame|request_recommendation|tool_success|tool_failure|confirmation_required|delete_task|create_reminder|create_and_schedule_task|query_schedule|ask_current_time|unsupported_intent|general_chat)\b/gi;

export class ResponseBoundary {
  private composer = new ResponseComposer();

  finalize(input: FinalizeInput): string {
    const explicitMessage = input.result.message?.trim();
    const raw =
      explicitMessage && explicitMessage.length > 0
        ? explicitMessage
        : this.composeWithKind(input);

    return this.sanitize(raw);
  }

  private composeWithKind(input: FinalizeInput): string {
    const kind = this.toResponseKind(input.result.responseKind);
    return this.composer.compose({
      context: input.context,
      frame: input.frame,
      plan: input.plan,
      toolResults: input.result.toolResults ?? [],
      queryBlocks: input.result.queryBlocks,
      responseKind: kind,
    });
  }

  private toResponseKind(value?: string): ResponseKind | undefined {
    if (!value) return undefined;
    return value as ResponseKind;
  }

  private sanitize(message: string): string {
    let text = message.trim();

    // Unwrap markdown-fenced JSON: ```json\n{...}\n```
    const fencedJsonMatch = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
    if (fencedJsonMatch) {
      try {
        const parsed = JSON.parse(fencedJsonMatch[1]) as Record<string, unknown>;
        const extracted = parsed.message ?? parsed.reply ?? parsed.content;
        if (typeof extracted === "string" && extracted.trim()) {
          text = extracted.trim();
        }
      } catch {
        // keep original
      }
    }

    // Unwrap bare JSON object
    if (text.startsWith("{") && text.endsWith("}")) {
      try {
        const parsed = JSON.parse(text) as { message?: unknown; reply?: unknown };
        const extracted = parsed.message ?? parsed.reply;
        if (typeof extracted === "string" && extracted.trim()) {
          text = extracted.trim();
        }
      } catch {
        // keep original
      }
    }

    // Remove internal names
    text = text.replace(INTERNAL_NAME_PATTERN, "").replace(/\s{2,}/g, " ").trim();

    // Collapse 3+ consecutive newlines to a single blank line
    text = text.replace(/\n{3,}/g, "\n\n");

    return text;
  }
}
