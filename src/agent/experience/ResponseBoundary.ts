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
  /\b(userGoal|tool|action|processWith|ToolRouter|LLMPlanner|ActionPlanner)\b/gi;

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
    const trimmed = message.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed) as { message?: unknown };
        if (typeof parsed.message === "string" && parsed.message.trim()) {
          return parsed.message.trim();
        }
      } catch {
        // noop
      }
    }

    return trimmed.replace(INTERNAL_NAME_PATTERN, "").replace(/\s{2,}/g, " ").trim();
  }
}
