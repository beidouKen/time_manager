import type { AgentHandler } from "@/agent/handlers/AgentHandler";
import type { AgentExperienceContext, AgentHandlerResult } from "@/agent/types";

export class FeedbackHandler implements AgentHandler {
  readonly domain = "feedback_or_complaint" as const;

  async handle(
    _userInput: string,
    _context: AgentExperienceContext
  ): Promise<AgentHandlerResult> {
    return {
      domain: this.domain,
      responseKind: "feedback",
    };
  }
}
