// ============================================================
// DeepSeekClient — DeepSeek API 实现（OpenAI-compatible）
//
// 网络适配约束（V3）：
// - 使用前端原生 fetch，不引入 @tauri-apps/plugin-http
// - 通过 LLMClient 接口隔离，AgentService 不直接依赖 fetch
// - CORS/网络错误时捕获并包装为 LLMError，上层统一处理
//
// V3.1 TODO：
// - 如果 Tauri 真机运行时出现 CORS 或 WebView 网络限制，
//   将 fetch 调用替换为 @tauri-apps/plugin-http 或 Rust command 代理，
//   LLMClient 接口和上层代码无需改动
// ============================================================

import { LLMError } from "@/agent/llm/LLMClient";
import type {
  LLMChatOptions,
  LLMChatResponse,
  LLMClient,
  LLMMessage,
} from "@/agent/llm/LLMClient";

interface DeepSeekConfig {
  baseURL: string;
  model: string;
  apiKey: string;
  enabled: boolean;
}

function getConfig(): DeepSeekConfig {
  return {
    baseURL:
      (import.meta.env.VITE_DEEPSEEK_BASE_URL as string | undefined) ||
      "https://api.deepseek.com",
    model:
      (import.meta.env.VITE_DEEPSEEK_MODEL as string | undefined) ||
      "deepseek-v4-pro",
    apiKey: (import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined) || "",
    enabled:
      (import.meta.env.VITE_LLM_AGENT_ENABLED as string | undefined) === "true",
  };
}

// OpenAI-compatible Chat Completions 响应体结构（仅用到的部分）
interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export class DeepSeekClient implements LLMClient {
  private config: DeepSeekConfig;

  constructor() {
    this.config = getConfig();
  }

  isAvailable(): boolean {
    const cfg = getConfig();
    return cfg.enabled && cfg.apiKey.length > 0;
  }

  getModelName(): string {
    return getConfig().model;
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMChatOptions
  ): Promise<LLMChatResponse> {
    // 每次调用重新读取配置（支持运行时环境变量更新）
    this.config = getConfig();

    if (!this.config.apiKey) {
      throw new LLMError(
        "api_key_missing",
        "尚未配置 DeepSeek API Key，请在 .env 文件中设置 VITE_DEEPSEEK_API_KEY"
      );
    }

    const url = `${this.config.baseURL}/chat/completions`;
    const body = {
      model: this.config.model,
      messages,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens ?? 1024,
      response_format: { type: "json_object" },
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // TypeError 是 CORS / 网络不可达 / WebView 限制的典型表现
      const isNetworkError = e instanceof TypeError;
      throw new LLMError(
        "network_error",
        isNetworkError
          ? `网络请求失败（可能是 CORS 或网络不可达）：${(e as Error).message}`
          : `请求异常：${String(e)}`
      );
    }

    if (!response.ok) {
      let errorDetail = "";
      try {
        const errBody = (await response.json()) as { error?: { message?: string } };
        errorDetail = errBody?.error?.message ?? "";
      } catch {
        // 忽略 JSON 解析失败
      }
      throw new LLMError(
        "http_error",
        `DeepSeek API 返回错误 ${response.status}${errorDetail ? `：${errorDetail}` : ""}`,
        response.status
      );
    }

    let data: ChatCompletionResponse;
    try {
      data = (await response.json()) as ChatCompletionResponse;
    } catch (e) {
      throw new LLMError("parse_error", `响应 JSON 解析失败：${String(e)}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LLMError("parse_error", "DeepSeek 响应缺少 choices[0].message.content");
    }

    return {
      content,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }
}
