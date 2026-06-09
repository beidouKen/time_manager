// ============================================================
// CompositePlanner.ts — V3.7 LLM-first + rule fallback 合成 Planner
//
// 策略：
// 1. 若 llmPlanner 可用且未禁用 → 尝试 llmPlanner.plan()
// 2. 若 LLM 抛出 LLMUnavailableError → 降级到 fallback（ActionPlanner）
// 3. 若 llmPlanner 不存在 → 直接走 fallback
//
// 提供 lastUsedPlanner 属性，供 TimeManagementAgent 写入 AgentTrace.planner。
// 提供 lastFallbackReason 属性，供 AgentTrace.errorKind 记录。
// ============================================================

import type { PlannerExtras, PlannerPort } from "@/agent/experience/PlannerPort";
import { ActionPlanner } from "@/agent/experience/ActionPlanner";
import {
  LLMExperiencePlanner,
  LLMUnavailableError,
} from "@/agent/llm/LLMExperiencePlanner";
import type {
  AgentExperienceContext,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";
import type { LLMUnavailableKind } from "@/agent/llm/LLMExperiencePlanner";
import type { RagInjectionMeta } from "@/agent/llm/LLMExperiencePlanner";

export class CompositePlanner implements PlannerPort {
  lastUsedPlanner: "llm" | "rule" = "rule";
  lastFallbackReason: LLMUnavailableKind | undefined = undefined;

  constructor(
    private llmPlanner: LLMExperiencePlanner | undefined,
    private fallback: ActionPlanner
  ) {}

  /**
   * V3.8+: 透传 llmPlanner.lastRagMeta，供 TimeManagementAgent 写入 AgentTrace。
   * 仅在最近一次 plan() 走 LLM 路径时有意义。
   */
  get lastRagMeta(): RagInjectionMeta | undefined {
    if (this.lastUsedPlanner !== "llm") return undefined;
    return this.llmPlanner?.lastRagMeta;
  }

  async plan(
    frame: SemanticFrame,
    context: AgentExperienceContext,
    extras?: PlannerExtras
  ): Promise<ExperienceActionPlan> {
    if (this.llmPlanner?.isAvailable()) {
      try {
        const plan = await this.llmPlanner.plan(frame, context, extras);
        this.lastUsedPlanner = "llm";
        this.lastFallbackReason = undefined;
        return plan;
      } catch (e) {
        if (e instanceof LLMUnavailableError) {
          this.lastFallbackReason = e.kind;
          console.warn(`[CompositePlanner] LLM 不可用（${e.kind}），降级到规则路径：${e.message}`);
        } else {
          this.lastFallbackReason = "fallback";
          console.warn("[CompositePlanner] LLM 未知错误，降级到规则路径：", e);
        }
      }
    } else {
      this.lastFallbackReason = this.llmPlanner ? "disabled" : undefined;
    }

    this.lastUsedPlanner = "rule";
    return this.fallback.plan(frame, context, extras);
  }
}
