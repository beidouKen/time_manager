import type { AgentHandler } from "@/agent/handlers/AgentHandler";
import type {
  AgentExperienceContext,
  AgentHandlerResult,
} from "@/agent/types";

type LLMDirectDomain = "general_chat" | "knowledge_qa" | "writing_assistant";

function toResponseKind(domain: LLMDirectDomain): string {
  if (domain === "knowledge_qa") return "knowledge_no_source";
  if (domain === "writing_assistant") return "writing_assist";
  return "general";
}

export class LLMDirectHandler implements AgentHandler {
  readonly domain: LLMDirectDomain;

  constructor(domain: LLMDirectDomain) {
    this.domain = domain;
  }

  async handle(
    userInput: string,
    _context: AgentExperienceContext
  ): Promise<AgentHandlerResult> {
    if (/^(你好|您好|哈喽|hello|hi)[！!。.\s]*$/i.test(userInput.trim())) {
      return {
        domain: this.domain,
        responseKind: "greeting",
      };
    }

    // Hard boundary for V3.6.1: LLMDirectHandler is read-only text path.
    // It never executes tools or writes data; return boundary-composed text kinds.
    return {
      domain: this.domain,
      responseKind: toResponseKind(this.domain),
    };
  }
}
