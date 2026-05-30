// ============================================================
// LLMExperiencePlanner.ts — V3.7 LLM-first PlannerPort 实现
//
// 职责：
// 1. 接收 SemanticFrame + AgentExperienceContext
// 2. 调用 LLMClient.chat()，使用 V3.7 system prompt（含 timeManagementSkill.md）
// 3. 解析并 schema 校验 LLM 输出（LLMExperiencePlanResponse）
// 4. 经过 PlanSafetyValidator 强制安全策略
// 5. 返回合法的 ExperienceActionPlan
//
// 不可用时（key 缺失 / 网络错误 / parse_error）：
// - 抛出 LLMUnavailableError，携带 errorKind，由 CompositePlanner 降级处理
//
// 安全约束：
// - 不直接执行任何 Tool
// - 不直接访问 Service / Repository
// ============================================================

import type { LLMClient } from "@/agent/llm/LLMClient";
import { LLMError } from "@/agent/llm/LLMClient";
import { buildSystemPrompt, formatContextBlock } from "@/agent/llm/prompts";
import type { LLMContext } from "@/agent/llm/contextBuilder";
import {
  parseLLMExperienceResponse,
  type LLMExperiencePlanResponse,
} from "@/agent/llm/experienceSchemas";
import type { PlannerPort } from "@/agent/experience/PlannerPort";
import type {
  AgentExperienceContext,
  ExperienceActionPlan,
  SemanticFrame,
  SinglePlanAction,
} from "@/agent/types";
import { PlanSafetyValidator } from "@/agent/validators/PlanSafetyValidator";
import type { ToolRouter } from "@/agent/ToolRouter";

// ─── 错误类型 ────────────────────────────────────────────────────────────────

export type LLMUnavailableKind =
  | "disabled"
  | "api_key_missing"
  | "network_error"
  | "http_error"
  | "parse_error"
  | "schema_invalid"
  | "safety_rejected"
  | "fallback";

export class LLMUnavailableError extends Error {
  constructor(
    public readonly kind: LLMUnavailableKind,
    message: string
  ) {
    super(message);
    this.name = "LLMUnavailableError";
  }
}

// ─── LLMExperiencePlanner ────────────────────────────────────────────────────

export class LLMExperiencePlanner implements PlannerPort {
  private validator: PlanSafetyValidator;

  constructor(
    private client: LLMClient,
    router: ToolRouter
  ) {
    this.validator = new PlanSafetyValidator(router);
  }

  isAvailable(): boolean {
    return this.client.isAvailable();
  }

  async plan(
    frame: SemanticFrame,
    context: AgentExperienceContext
  ): Promise<ExperienceActionPlan> {
    if (!this.client.isAvailable()) {
      throw new LLMUnavailableError("disabled", "LLM 客户端不可用（未配置 API key 或已禁用）");
    }

    const systemPrompt = buildSystemPrompt(
      new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
    );

    // 构造精简上下文（不调 DB，直接从 context 中提取可用信息）
    const llmContext = this.buildLLMContext(context);
    const contextBlock = formatContextBlock(llmContext);

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...context.recentMessages
        .slice(-6)
        .map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content,
        })),
      {
        role: "user" as const,
        content: `${contextBlock}\n${frame.extractedTitle ?? "（无标题）"}`,
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
        throw new LLMUnavailableError(
          e.kind === "api_key_missing" ? "api_key_missing"
            : e.kind === "network_error" ? "network_error"
            : e.kind === "http_error" ? "http_error"
            : "fallback",
          e.message
        );
      }
      throw new LLMUnavailableError("fallback", `未知错误：${String(e)}`);
    }

    // 解析 + schema 校验
    const parseResult = parseLLMExperienceResponse(rawContent);
    if (!parseResult.success) {
      throw new LLMUnavailableError("parse_error", parseResult.error);
    }

    const llmResp = parseResult.data;

    // 转换为 ExperienceActionPlan
    const plan = this.toPlan(llmResp, frame, context);

    // 经过 PlanSafetyValidator
    const safetyResult = this.validator.validate(plan);
    if (!safetyResult.ok) {
      throw new LLMUnavailableError(
        "safety_rejected",
        `PlanSafetyValidator 拒绝：${safetyResult.reason}`
      );
    }

    return safetyResult.plan;
  }

  // ─── 辅助方法 ──────────────────────────────────────────────────────────────

  private buildLLMContext(context: AgentExperienceContext): LLMContext {
    const currentDate = context.currentDatetime.slice(0, 10);
    return {
      recentMessages: context.recentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      todayTasks: [],
      todayBlocks: [],
      lastTaskId: context.lastCreatedTaskId,
      lastTimeBlockId: context.lastScheduledTimeBlockIds[0] ?? null,
      currentDate,
    };
  }

  private toPlan(
    resp: LLMExperiencePlanResponse,
    frame: SemanticFrame,
    context: AgentExperienceContext
  ): ExperienceActionPlan {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const actions: SinglePlanAction[] | undefined =
      resp.actions?.map((a) => ({
        toolName: a.toolName,
        params: a.params,
        summary: a.summary,
      }));

    const params: Record<string, unknown> = { ...resp.params };
    if (actions !== undefined) {
      params.actions = actions;
    }

    return {
      id,
      kind: resp.kind as ExperienceActionPlan["kind"],
      userGoal: resp.userGoal as ExperienceActionPlan["userGoal"],
      toolName: resp.toolName ?? undefined,
      params,
      requiresConfirmation: resp.requiresConfirmation,
      riskLevel: resp.riskLevel,
      summary: resp.summary,
      createdAt: now,
      traceLabel: `llm:${resp.kind}:${resp.userGoal}`,
      replayKey: `llm:${frame.userGoal}:${context.currentDatetime.slice(0, 16)}`,
    };
  }
}
