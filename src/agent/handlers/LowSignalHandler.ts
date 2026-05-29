import type { AgentHandler } from "@/agent/handlers/AgentHandler";
import type { AgentExperienceContext, AgentHandlerResult } from "@/agent/types";

export class LowSignalHandler implements AgentHandler {
  readonly domain = "low_signal" as const;

  async handle(
    _userInput: string,
    _context: AgentExperienceContext
  ): Promise<AgentHandlerResult> {
    return {
      domain: this.domain,
      responseKind: "low_signal",
    };
  }
}
