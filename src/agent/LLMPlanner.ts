// ============================================================
// LLMPlanner.ts — LLM 意图解析核心逻辑
//
// 职责：
// 1. 接收用户输入 + LLMContext
// 2. 组装 LLM messages（system prompt + 上下文 + 用户输入）
// 3. 调用 LLMClient.chat()
// 4. Zod schema 校验 LLM 输出
// 5. 安全校验（toolName 存在性、确认策略覆盖）
// 6. 返回 LLMPlanResult（供 AgentService 消费）
//
// 注意：
// - LLMPlanner 不执行工具，只输出结构化计划
// - LLMPlanner 不直接依赖 fetch，通过 LLMClient 接口隔离
// ============================================================

import type { LLMClient } from "@/agent/llm/LLMClient";
import { LLMError } from "@/agent/llm/LLMClient";
import type { LLMContext } from "@/agent/llm/contextBuilder";
import { buildSystemPrompt, formatContextBlock } from "@/agent/llm/prompts";
import { parseLLMResponse } from "@/agent/llm/schemas";
import type { LLMResponse } from "@/agent/llm/schemas";
import { CONFIRMATION_POLICY } from "@/agent/types";
import type { AgentActionPlan, IntentType, RiskLevel } from "@/agent/types";
import type { ToolRouter } from "@/agent/ToolRouter";

// ─── 结果类型 ────────────────────────────────────────────────────────────────

export type LLMPlanResultType =
  | "tool_plan"
  | "clarification"
  | "chitchat"
  | "unsupported"
  | "api_key_missing"
  | "network_error"
  | "parse_error"
  | "fallback";

export interface LLMPlanResult {
  type: LLMPlanResultType;

  /** type=tool_plan 时填充 */
  intent?: IntentType;
  toolName?: string;
  params?: Record<string, unknown>;
  requiresConfirmation?: boolean;
  riskLevel?: RiskLevel;
  summary?: string;
  confidence?: number;

  /** type=clarification 时填充 */
  clarifyingQuestion?: string;

  /** type=chitchat | unsupported | error 时填充 */
  replyMessage?: string;

  /** LLM 原始响应（调试用） */
  rawLLMResponse?: LLMResponse;

  /** 错误信息（error 类型时填充） */
  errorMessage?: string;

  /** 使用的模型名称 */
  modelName?: string;
}

// ─── 适配函数：将 LLMPlanResult 映射为 AgentActionPlan 雏形 ─────────────────

/**
 * 将成功的 LLMPlanResult（type=tool_plan）映射为 AgentActionPlan。
 * 非 tool_plan 类型返回 null。
 */
export function toAgentActionPlan(result: LLMPlanResult): AgentActionPlan | null {
  if (result.type !== "tool_plan") return null;
  return {
    id: crypto.randomUUID(),
    commandId: "",
    intent: result.intent!,
    toolName: result.toolName!,
    params: result.params ?? {},
    requiresConfirmation: result.requiresConfirmation ?? false,
    riskLevel: result.riskLevel ?? "safe",
    summary: result.summary ?? "",
    createdAt: new Date().toISOString(),
  };
}

// ─── 危险操作列表（代码层强制确认，不信任 LLM 输出） ───────────────────────

const FORCED_CONFIRMATION_INTENTS: Set<string> = new Set([
  "delete_task",
  "delete_time_block",
  "reschedule_day",
]);

// ─── LLMPlanner ─────────────────────────────────────────────────────────────

export class LLMPlanner {
  constructor(
    private client: LLMClient,
    private router: ToolRouter
  ) {}

  /**
   * 将用户输入 + 上下文转换为结构化计划。
   * 不会抛出异常——所有错误都封装在返回值的 type 中。
   */
  async plan(userInput: string, context: LLMContext): Promise<LLMPlanResult> {
    const modelName = this.client.getModelName();

    // 组装 messages
    const systemPrompt = buildSystemPrompt(
      new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
    );
    const contextBlock = formatContextBlock({
      ...context,
      lastTaskId: context.lastTaskId ?? undefined,
      lastTimeBlockId: context.lastTimeBlockId ?? undefined,
    });

    const messages = [
      { role: "system" as const, content: systemPrompt },
      // 历史对话：由 chatStore 在调用前已截取，不含当前用户消息（V3.5 fix）
      ...context.recentMessages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      // 当前用户消息，前置上下文块
      {
        role: "user" as const,
        content: `${contextBlock}\n${userInput}`,
      },
    ];

    // 调用 LLM
    let rawContent: string;
    try {
      const response = await this.client.chat(messages, {
        temperature: 0.1,
        maxTokens: 1024,
      });
      rawContent = response.content;
    } catch (e) {
      if (e instanceof LLMError) {
        if (e.kind === "api_key_missing") {
          return {
            type: "api_key_missing",
            errorMessage: e.message,
            modelName,
          };
        }
        if (e.kind === "network_error") {
          console.warn("[LLMPlanner] 网络错误：", e.message);
          return {
            type: "network_error",
            errorMessage: e.message,
            modelName,
          };
        }
        console.warn("[LLMPlanner] HTTP 错误：", e.message);
        return {
          type: "fallback",
          errorMessage: e.message,
          modelName,
        };
      }
      console.warn("[LLMPlanner] 未知错误：", e);
      return {
        type: "fallback",
        errorMessage: String(e),
        modelName,
      };
    }

    // 解析 + schema 校验
    const parseResult = parseLLMResponse(rawContent);
    if (!parseResult.success) {
      console.warn("[LLMPlanner] LLM 输出解析失败：", parseResult.error);
      return {
        type: "parse_error",
        errorMessage: parseResult.error,
        modelName,
      };
    }

    const llmResp = parseResult.data;

    // 非 tool_plan 类型，直接返回
    if (llmResp.type !== "tool_plan") {
      return this.buildNonToolResult(llmResp, modelName);
    }

    // tool_plan：安全校验
    return this.validateAndBuildToolPlan(llmResp, modelName);
  }

  // ─── 私有辅助方法 ──────────────────────────────────────────────────────────

  private buildNonToolResult(
    resp: LLMResponse,
    modelName: string
  ): LLMPlanResult {
    switch (resp.type) {
      case "clarification":
        return {
          type: "clarification",
          clarifyingQuestion:
            resp.clarifyingQuestion ?? resp.summary ?? "请提供更多信息。",
          confidence: resp.confidence,
          rawLLMResponse: resp,
          modelName,
        };
      case "chitchat":
        return {
          type: "chitchat",
          replyMessage: resp.summary || "好的。",
          confidence: resp.confidence,
          rawLLMResponse: resp,
          modelName,
        };
      case "unsupported":
        return {
          type: "unsupported",
          replyMessage:
            resp.summary ||
            "抱歉，该功能超出了 Time Manager 当前的能力范围，无法执行。",
          confidence: resp.confidence,
          rawLLMResponse: resp,
          modelName,
        };
      default:
        return {
          type: "fallback",
          errorMessage: `未知的 LLM 响应类型：${resp.type}`,
          modelName,
        };
    }
  }

  private validateAndBuildToolPlan(
    resp: LLMResponse,
    modelName: string
  ): LLMPlanResult {
    const toolName = resp.toolName;

    // 1. toolName 必须非空
    if (!toolName) {
      return {
        type: "fallback",
        errorMessage: "LLM 返回 tool_plan 但 toolName 为空",
        modelName,
      };
    }

    // 2. toolName 必须在 ToolRouter 注册表中
    if (!this.router.getTool(toolName)) {
      return {
        type: "fallback",
        errorMessage: `LLM 选择了未注册的工具：${toolName}`,
        rawLLMResponse: resp,
        modelName,
      };
    }

    // 3. intent 映射（将 LLMIntent 转为 IntentType）
    const intent = resp.intent as IntentType;
    if (intent === "unknown") {
      return {
        type: "fallback",
        errorMessage: "LLM 返回 tool_plan 但 intent 不是有效工具意图",
        rawLLMResponse: resp,
        modelName,
      };
    }

    // 4. 安全覆盖：确认策略以 CONFIRMATION_POLICY 为准，不信任 LLM 的 requiresConfirmation
    const policyRisk: RiskLevel = CONFIRMATION_POLICY[intent] ?? "safe";
    const toolRequiresConfirm = this.router.hasToolRequiringConfirmation(toolName);
    const requiresConfirmation =
      FORCED_CONFIRMATION_INTENTS.has(toolName) ||
      policyRisk === "destructive" ||
      toolRequiresConfirm;

    // 5. riskLevel 以 CONFIRMATION_POLICY 为准
    const riskLevel: RiskLevel = policyRisk;

    return {
      type: "tool_plan",
      intent,
      toolName,
      params: resp.params,
      requiresConfirmation,
      riskLevel,
      summary: resp.summary,
      confidence: resp.confidence,
      rawLLMResponse: resp,
      modelName,
    };
  }
}

