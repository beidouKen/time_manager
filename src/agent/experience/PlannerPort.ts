// ============================================================
// PlannerPort.ts — Planner 抽象接口
//
// 职责：定义从 SemanticFrame + AgentExperienceContext 到
//       ExperienceActionPlan 的标准契约。
//
// 生产侧唯一实现：ActionPlanner（同文件夹）。
// 测试侧可注入：StubPlanner（src/agent/testing/StubPlanner.ts）。
//
// 禁止：
// - 不允许 PlannerPort 实现直接调用 Service / ToolRouter。
// - 不允许在 AgentService 默认构造时使用 StubPlanner。
// ============================================================

import type { AgentExperienceContext, ExperienceActionPlan, SemanticFrame } from "@/agent/types";

/**
 * V3.8+: planner 可选透传额外信号。
 * - userInput: 原始用户输入，供 RAG 等上下文构建层构造 query。
 *
 * 这是一个可选 prop，现有实现可以忽略；新增字段保持向后兼容。
 */
export interface PlannerExtras {
  userInput?: string;
}

export interface PlannerPort {
  plan(
    frame: SemanticFrame,
    context: AgentExperienceContext,
    extras?: PlannerExtras
  ): Promise<ExperienceActionPlan>;
}
