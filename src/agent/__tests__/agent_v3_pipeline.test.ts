/**
 * agent_v3_pipeline.test.ts — Phase 2 Agent V3 Tests
 *
 * 验证 Phase 2 目标：
 *   - PlannerPort 注入 + 替换（ActionPlanner 唯一生产实现，StubPlanner 防御性）
 *   - trace 扩展（planSummary、traceLabel、confirmationMetadata）
 *   - boundary sanitize 回归
 *   - StubPlanner 防御性测试（非法 toolName、绕过 confirmation）
 * 至少 8 条 mock test，不接真实 LLM。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAgentHarness } from "@/agent/testing/createMockAgentHarness";
import { StubPlanner } from "@/agent/testing/StubPlanner";
import {
  expectNoInternalNames,
} from "@/agent/testing/mockInput";

const NOW = "2026-05-30T04:00:00.000Z"; // UTC 04:00 = Asia/Shanghai 12:00

describe("Phase 2 Agent V3 Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── V3-1: 提醒请求不走 general_chat ─────────────────────────────────────

  it("v3-1: reminder does not route to general_chat", async () => {
    const { agent, blocks } = createMockAgentHarness();
    const response = await agent.processInput("下午两点提醒我开会");
    // 提醒写 block（type=event），不写 task，不是 general_chat
    expect(blocks.blocks).toHaveLength(1);
    expect(blocks.blocks[0].type).toBe("event");
    expectNoInternalNames(response.message);
  });

  // ─── V3-2: 多日期混合输入仍进入 time_management ──────────────────────────

  it("v3-2: reminder with multi-date input stays in time_management", async () => {
    const { agent, blocks } = createMockAgentHarness();
    // 多日期混合输入
    const response = await agent.processInput(
      "今天下午三点和明天上午十点都提醒我复盘"
    );
    // 至少写一个 block（提醒路径）
    expect(blocks.blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks.blocks[0].type).toBe("event");
    expectNoInternalNames(response.message);
  });

  // ─── V3-3: ActionPlanner 通过 PlannerPort 注入后 trace 含 planSummary ───

  it("v3-3: trace contains planSummary after PlannerPort injection", async () => {
    const { agent } = createMockAgentHarness();
    const response = await agent.processInput(
      "我现在有一个写代码任务，30分钟，从现在开始"
    );
    const trace = response.metadata?.agentTrace;
    expect(trace).toBeDefined();
    expect(trace?.planSummary).toBeDefined();
    expect(typeof trace?.planSummary).toBe("string");
    expect(trace?.planSummary!.length).toBeGreaterThan(0);
  });

  // ─── V3-4: delete 请求进入 confirmation_required，trace 含 confirmationMetadata ──

  it("v3-4: delete request enters confirmation_required with confirmationMetadata in trace", async () => {
    const { agent, tasks, confirmRepo } = createMockAgentHarness();
    // 先创建一个任务
    await agent.processInput("我现在有一个开会任务，30分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(1);

    const beforeCount = tasks.tasks.length;
    const response = await agent.processInput("删除开会任务");

    // confirmationId 存在（进入确认链路）
    expect(response.confirmationId).toBeTruthy();
    // 任务数量未减少（未删除）
    const activeAfter = tasks.tasks.filter((t) => !t.deleted_at);
    expect(activeAfter).toHaveLength(beforeCount);

    const trace = response.metadata?.agentTrace;
    expect(trace?.confirmationMetadata).toBeDefined();
    expect(trace?.confirmationMetadata?.toolName).toBe("delete_task");

    // confirmRepo 中有 pending 记录
    const pending = confirmRepo.records.find(
      (r) => r.status === "pending" && r.tool_name === "delete_task"
    );
    expect(pending).toBeDefined();
  });

  // ─── V3-5: boundary 可回放：相同输入 → 相同 traceLabel ───────────────────

  it("v3-5: same input produces same traceLabel (replayable)", async () => {
    const input = "我现在有一个写文档任务，15分钟，从现在开始";

    const { agent: agent1 } = createMockAgentHarness();
    const r1 = await agent1.processInput(input);
    const traceLabel1 = r1.metadata?.agentTrace?.actionPlan?.traceLabel;

    const { agent: agent2 } = createMockAgentHarness();
    const r2 = await agent2.processInput(input);
    const traceLabel2 = r2.metadata?.agentTrace?.actionPlan?.traceLabel;

    expect(traceLabel1).toBe(traceLabel2);
    expect(traceLabel1).toMatch(/^create_and_schedule_task:/);
  });

  // ─── V3-6: 推荐链路 confirmation 后写入 ──────────────────────────────────

  it("v3-6: recommendation flow creates confirmation, then writes on confirm", async () => {
    const { agent, tasks, blocks, confirmRepo } = createMockAgentHarness();
    // 模糊时间 → 推荐
    const r1 = await agent.processInput("帮我安排一个复盘任务，30分钟");
    // 无明确时间 → confirmation_required（推荐路径）
    expect(r1.confirmationId).toBeDefined();
    expect(tasks.tasks).toHaveLength(0);

    // 确认
    const confirmId = r1.confirmationId!;
    const r2 = await agent.confirmAction(confirmId);
    expect(r2.toolResult?.success).toBe(true);
    expect(tasks.tasks).toHaveLength(1);
    expect(blocks.blocks).toHaveLength(1);

    // confirmRepo 已完成
    const done = confirmRepo.records.find((r) => r.id === confirmId);
    expect(done?.status).toBe("confirmed");
  });

  // ─── V3-7: StubPlanner 防御性测试 A：非法 toolName 被拒绝 ────────────────

  it("v3-7 [defense-A]: StubPlanner with nonexistent_tool is rejected, 0 writes", async () => {
    const stub = new StubPlanner({
      kind: "tool",
      toolName: "nonexistent_tool",
      params: {},
      requiresConfirmation: false,
      riskLevel: "safe",
      summary: "stub plan",
    });

    const { agent, tasks, blocks } = createMockAgentHarness({
      plannerPort: stub,
    });

    // 使用时间管理相关输入，确保路由到 time_management agent
    const response = await agent.processInput("帮我安排一个任务");
    // AgentService 应该拒绝执行，走 boundary fallback
    expect(tasks.tasks).toHaveLength(0);
    expect(blocks.blocks).toHaveLength(0);
    // 响应不含内部名
    expectNoInternalNames(response.message);
    // trace 应标记 invalid_tool
    const trace = response.metadata?.agentTrace;
    expect(trace?.errorKind).toBe("invalid_tool");
  });

  // ─── V3-8: StubPlanner 防御性测试 B：绕过 confirmation 被拦截 ────────────

  it("v3-8 [defense-B]: StubPlanner bypassing confirmation is blocked for delete_task", async () => {
    // 注入绕过确认的 stub planner（delete_task 但声称不需要确认）
    const stub = new StubPlanner({
      kind: "tool",
      toolName: "delete_task",
      params: { taskId: "some-task-id", title: "写代码" },
      requiresConfirmation: false, // 试图绕过
      riskLevel: "safe", // 错误降级
      summary: "stub delete bypass",
    });

    const { agent: agentWithStub } = createMockAgentHarness({ plannerPort: stub });

    // delete_task 工具注册了 requiresConfirmation=true，policy 应该强制升级
    const response = await agentWithStub.processInput("删除写代码任务");
    // 应该进入确认链路，而非静默删除
    expect(response.confirmationId).toBeDefined();
    expectNoInternalNames(response.message);
  });

  // ─── V3-9: low_signal 输入不绕过 boundary ────────────────────────────────

  it("v3-9: low_signal input does not bypass boundary", async () => {
    const { agent, tasks } = createMockAgentHarness();
    const lowSignalInputs = ["?", "??", "嗯", "好的", "哈哈", "..."];

    for (const input of lowSignalInputs) {
      const response = await agent.processInput(input);
      expectNoInternalNames(response.message);
      // 不写库
      expect(tasks.tasks).toHaveLength(0);
    }
  });
});
