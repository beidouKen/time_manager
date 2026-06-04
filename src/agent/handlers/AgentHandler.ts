import type { AgentDomain, AgentExperienceContext, AgentHandlerResult } from "@/agent/types";
import type { WorkingMemoryPacket } from "@/agent/context/WorkingMemoryPacket";

export interface AgentHandler {
  readonly domain: AgentDomain;
  handle(
    userInput: string,
    context: AgentExperienceContext,
    packet?: WorkingMemoryPacket
  ): Promise<AgentHandlerResult>;
}
