import type { AgentHandler } from "@/agent/handlers/AgentHandler";
import type { AgentExperienceContext, AgentHandlerResult } from "@/agent/types";

export class ExternalInfoHandler implements AgentHandler {
  readonly domain = "external_info" as const;

  async handle(
    _userInput: string,
    _context: AgentExperienceContext
  ): Promise<AgentHandlerResult> {
    return {
      domain: this.domain,
      responseKind: "external_info_no_tool",
    };
  }
}
