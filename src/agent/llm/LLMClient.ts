// ============================================================
// LLMClient — 统一 LLM 接口定义
//
// 设计原则：
// 1. 不绑定任何具体 LLM 提供方（DeepSeek / OpenAI / 本地模型）
// 2. AgentService / LLMPlanner 只依赖此接口，不直接依赖 fetch
// 3. 切换实现（如 V3.1 从 fetch 改为 Tauri HTTP plugin）时，
//    上层代码无需改动
// ============================================================

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LLMChatResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * LLM 错误类型，用于区分不同的失败原因。
 */
export type LLMErrorKind =
  | "api_key_missing"   // API key 未配置
  | "network_error"     // 网络错误 / CORS / WebView 限制
  | "http_error"        // HTTP 非 200 响应
  | "parse_error"       // 响应体解析失败
  | "unknown";          // 其他未知错误

export class LLMError extends Error {
  constructor(
    public readonly kind: LLMErrorKind,
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "LLMError";
  }
}

/**
 * 统一 LLM 客户端接口。
 * 所有具体实现（DeepSeekClient 等）均实现此接口。
 */
export interface LLMClient {
  /**
   * 发起对话请求。
   * @throws {LLMError} 当请求失败时抛出，包含错误类型信息
   */
  chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResponse>;

  /**
   * 检查客户端是否可用（API key 已配置且 enabled）。
   * 返回 false 时调用方应 fallback 到规则 IntentParser。
   */
  isAvailable(): boolean;

  /**
   * 返回当前使用的模型名称，用于写入 ChatMessageMetadata.llmModel。
   */
  getModelName(): string;
}
