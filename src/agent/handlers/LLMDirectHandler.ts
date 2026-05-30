// V3.7: 接入 LLMChatExecutor（可选）。若不可用，退回 responseKind boundary。
import type { AgentHandler } from "@/agent/handlers/AgentHandler";
import type {
  AgentExperienceContext,
  AgentHandlerResult,
} from "@/agent/types";
import type { LLMChatExecutor } from "@/agent/llm/LLMChatExecutor";

type LLMDirectDomain = "general_chat" | "knowledge_qa" | "writing_assistant";

function toResponseKind(domain: LLMDirectDomain): string {
  if (domain === "knowledge_qa") return "knowledge_no_source";
  if (domain === "writing_assistant") return "writing_assist";
  return "general";
}

export class LLMDirectHandler implements AgentHandler {
  readonly domain: LLMDirectDomain;

  constructor(
    domain: LLMDirectDomain,
    private llmExecutor?: LLMChatExecutor
  ) {
    this.domain = domain;
  }

  async handle(
    userInput: string,
    context: AgentExperienceContext
  ): Promise<AgentHandlerResult> {
    if (/^(你好|您好|哈喽|hello|hi)[！!。.\s]*$/i.test(userInput.trim())) {
      return {
        domain: this.domain,
        responseKind: "greeting",
      };
    }

    // V3.7: 若 LLM executor 可用，调用真实 LLM 获取文本回复
    if (this.llmExecutor?.isAvailable()) {
      try {
        const text = await this.llmExecutor.execute(
          this.domain,
          userInput,
          context.recentMessages
        );
        return {
          domain: this.domain,
          message: text,
          responseKind: toResponseKind(this.domain),
        };
      } catch {
        // 降级到 boundary 兜底
      }
    }

    // Hard boundary fallback：不调用 ToolRouter，不写数据
    return {
      domain: this.domain,
      responseKind: toResponseKind(this.domain),
    };
  }
}
