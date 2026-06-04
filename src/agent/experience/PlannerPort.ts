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
import type { WorkingMemoryPacket } from "@/agent/context/WorkingMemoryPacket";

export interface PlannerPort {
  plan(
    frame: SemanticFrame,
    context: AgentExperienceContext,
    packet?: WorkingMemoryPacket
  ): Promise<ExperienceActionPlan>;
}
