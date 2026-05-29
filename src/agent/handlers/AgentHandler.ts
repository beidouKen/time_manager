import type { AgentDomain, AgentExperienceContext, AgentHandlerResult } from "@/agent/types";

export interface AgentHandler {
  readonly domain: AgentDomain;
  handle(
    userInput: string,
    context: AgentExperienceContext
  ): Promise<AgentHandlerResult>;
}
