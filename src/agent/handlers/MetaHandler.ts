import type { AgentHandler } from "@/agent/handlers/AgentHandler";
import type { AgentExperienceContext, AgentHandlerResult } from "@/agent/types";

export class MetaHandler implements AgentHandler {
  readonly domain = "assistant_meta" as const;

  async handle(
    _userInput: string,
    _context: AgentExperienceContext
  ): Promise<AgentHandlerResult> {
    return {
      domain: this.domain,
      responseKind: "meta_identity",
    };
  }
}
