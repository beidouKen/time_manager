// ============================================================
// StubPlanner.ts — 防御性测试用 PlannerPort 实现
//
// 仅供测试目录使用，禁止被 AgentService 默认装配。
// 用途：注入预设的非法或边缘 plan，验证 AgentService /
//       TimeManagementAgent 的防御层能正确拦截。
//
// 示例用法：
//   const stub = new StubPlanner({ kind: "tool", toolName: "nonexistent_tool", ... });
//   const { agent } = createMockAgentHarness({ plannerPort: stub });
//   const resp = await agent.processInput("some input");
//   expect(resp.message).not.toContain("success"); // boundary fallback
// ============================================================

import type { PlannerPort } from "@/agent/experience/PlannerPort";
import type {
  AgentExperienceContext,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";

export type StubPlanSpec = Partial<ExperienceActionPlan> & {
  kind: ExperienceActionPlan["kind"];
};

export class StubPlanner implements PlannerPort {
  private spec: StubPlanSpec;

  constructor(spec: StubPlanSpec) {
    this.spec = spec;
  }

  async plan(
    frame: SemanticFrame,
    context: AgentExperienceContext
  ): Promise<ExperienceActionPlan> {
    return {
      id: crypto.randomUUID(),
      userGoal: frame.userGoal,
      requiresConfirmation: false,
      riskLevel: "safe",
      params: { currentDatetime: context.currentDatetime },
      summary: `stub:${this.spec.kind}`,
      createdAt: new Date().toISOString(),
      ...this.spec,
    } as ExperienceActionPlan;
  }

  /** 运行时替换 plan spec（供一个 describe 内多 case 复用） */
  setSpec(spec: StubPlanSpec): void {
    this.spec = spec;
  }
}
