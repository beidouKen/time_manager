// ============================================================
// LLMChatExecutor.ts — V3.7 只读 LLM 对话执行器
//
// 专为 general_chat / knowledge_qa / writing_assistant 等
// 只读域设计。
//
// 安全约束（绝对不可破坏）：
// 1. 不调用任何 ToolRouter
// 2. 不访问任何 Service / Repository
// 3. 不执行任何写操作
// 4. 若 LLM 返回 JSON / 内部 tool 调用，直接剥离后当文本处理
// 5. LLM 不可用时抛错，由调用方降级
// ============================================================

import type { LLMClient } from "@/agent/llm/LLMClient";
import { LLMError } from "@/agent/llm/LLMClient";
import type { WorkingMemoryPacket } from "@/agent/context/WorkingMemoryPacket";

export type ChatDomain = "general_chat" | "knowledge_qa" | "writing_assistant";

const SYSTEM_PROMPTS: Record<ChatDomain, string> = {
  general_chat:
    "你是一个友好的个人助理。只能回复文本，不能执行任何操作，不能调用工具，不能修改任何数据。回复简洁自然。",
  knowledge_qa:
    "你是一个知识助手。只能回复文本，不能执行任何操作。提供准确的信息并注明这是你的知识，无需引用外部来源。",
  writing_assistant:
    "你是一个写作助手。只能提供写作建议、改写或草稿，不能执行任何操作。直接输出建议或改写结果。",
};

/**
 * 仅用于只读 LLM 对话。不接触任何写操作。
 */
export class LLMChatExecutor {
  constructor(private client: LLMClient) {}

  isAvailable(): boolean {
    return this.client.isAvailable();
  }

  /**
   * 执行只读 LLM 对话，返回纯文本字符串。
   * C4: 可传入 WorkingMemoryPacket 使用 recent_messages（已过滤软删除 / 统一截断口径）。
   * @throws LLMError / Error 若调用失败
   */
  async execute(
    domain: ChatDomain,
    userInput: string,
    recentMessages: Array<{ role: string; content: string }> = [],
    packet?: WorkingMemoryPacket
  ): Promise<string> {
    const systemPrompt = SYSTEM_PROMPTS[domain];

    // C4: 优先使用 packet 的 recent_messages（已过滤软删除，统一截断 300 字）
    const sourceMsgs = packet
      ? packet.conversationSummary.recentMessages
      : recentMessages;

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...sourceMsgs
        .slice(-4)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content:
            m.content.length > 200 ? m.content.slice(0, 200) + "…" : m.content,
        })),
      { role: "user", content: userInput },
    ];

    try {
      const response = await this.client.chat(messages, {
        temperature: 0.7,
        maxTokens: 512,
      });

      // 剥离可能存在的 JSON 包装（防止 LLM 误返回工具调用格式）
      const raw = response.content.trim();
      return this.stripJsonIfPresent(raw);
    } catch (e) {
      if (e instanceof LLMError) throw e;
      throw new Error(`LLMChatExecutor 调用失败：${String(e)}`);
    }
  }

  private stripJsonIfPresent(text: string): string {
    const trimmed = text.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        // 如果是合法的 JSON 对象但不像普通文本，提取 message/content/summary 字段
        if (typeof parsed === "object" && parsed !== null) {
          const msg =
            (parsed as Record<string, unknown>).message ??
            (parsed as Record<string, unknown>).content ??
            (parsed as Record<string, unknown>).summary;
          if (typeof msg === "string") return msg;
        }
      } catch {
        // 不是合法 JSON，当原始文本返回
      }
    }
    return text;
  }
}
