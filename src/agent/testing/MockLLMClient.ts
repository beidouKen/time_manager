// ============================================================
// MockLLMClient.ts — V3.7 测试用 LLM 客户端
//
// 构造时传入 script 数组：
// - matcher: RegExp | string — 匹配 user message 中最后一条 content
// - response: LLMExperiencePlanResponse（成功）或 LLMError（抛出）
//
// 若无 script 匹配，抛出 LLMError(parse_error) 模拟 LLM 故障降级。
// ============================================================

import type {
  LLMClient,
  LLMMessage,
  LLMChatOptions,
  LLMChatResponse,
} from "@/agent/llm/LLMClient";
import { LLMError } from "@/agent/llm/LLMClient";
import type { LLMExperiencePlanResponse } from "@/agent/llm/experienceSchemas";

export type MockLLMScript = {
  matcher: RegExp | string;
  response: LLMExperiencePlanResponse | LLMError;
};

export class MockLLMClient implements LLMClient {
  private scripts: MockLLMScript[];
  private callLog: string[] = [];

  constructor(scripts: MockLLMScript[] = []) {
    this.scripts = scripts;
  }

  isAvailable(): boolean {
    return true;
  }

  getModelName(): string {
    return "mock-llm-v1";
  }

  getCallLog(): string[] {
    return [...this.callLog];
  }

  async chat(
    messages: LLMMessage[],
    _options?: LLMChatOptions
  ): Promise<LLMChatResponse> {
    // 找最后一条 user message
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const input = lastUser?.content ?? "";
    this.callLog.push(input);

    for (const script of this.scripts) {
      const matched =
        script.matcher instanceof RegExp
          ? script.matcher.test(input)
          : input.includes(script.matcher);

      if (matched) {
        if (script.response instanceof LLMError) {
          throw script.response;
        }
        return {
          content: JSON.stringify(script.response),
        };
      }
    }

    // 无匹配 → 模拟 LLM 返回无法解析的内容，触发 parse_error 降级
    throw new LLMError("parse_error", "MockLLMClient: 无匹配 script，模拟 parse_error");
  }
}
