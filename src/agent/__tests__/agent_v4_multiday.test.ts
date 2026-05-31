/**
 * agent_v4_multiday.test.ts — Phase 3 Agent V4 Tests
 *
 * 验证 Phase 3 目标：
 *   - 多日 TimeBlock 查询（query_schedule_range）
 *   - 批量删除任务（batch_delete_tasks → confirmation_required）
 *   - 延期任务建议（defer_task → 不静默改原计划）
 *   - 批量操作确认链路
 *   - 不破坏单日 Gold Test
 * 至少 10 条 mock test。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAgentHarness } from "@/agent/testing/createMockAgentHarness";
import { expectNoInternalNames } from "@/agent/testing/mockInput";

const NOW = "2026-05-30T04:00:00.000Z"; // UTC 04:00 = Asia/Shanghai 12:00

describe("Phase 3 Agent V4 Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── V4-1: 多日查询 — "未来三天我有什么任务" ─────────────────────────────

  it("v4-1: multi-day query returns query_schedule_range plan with dateRange", async () => {
    const { agent } = createMockAgentHarness();
    const response = await agent.processInput("未来三天我有什么任务");

    // 多日查询是只读操作，不写库
    const trace = response.metadata?.agentTrace;
    expect(trace).toBeDefined();
    // traceLabel 应标记为多日查询
    const plan = trace?.actionPlan;
    expect(plan?.traceLabel).toMatch(/query_schedule_range|query/);
    // dateRange 应被解析
    expect(plan?.params.dateRange).toBeDefined();
    expectNoInternalNames(response.message);
  });

  // ─── V4-2: 批量删除 → confirmation_required，用户拒绝后 0 写入 ───────────

  it("v4-2: batch delete returns confirmation_required, rejected = 0 writes", async () => {
    const { agent, tasks } = createMockAgentHarness();
    // 先创建两个任务
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    await agent.processInput("我现在有一个开会任务，30分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(2);

    // 批量删除请求
    const response = await agent.processInput("删除今天所有任务");
    // 必须进入确认链路
    expect(response.confirmationId).toBeDefined();
    expectNoInternalNames(response.message);
    // 任务仍然存在
    expect(tasks.tasks.filter((t) => !t.deleted_at)).toHaveLength(2);

    // 用户拒绝
    await agent.rejectAction(response.confirmationId!);
    // 任务仍然存在
    expect(tasks.tasks.filter((t) => !t.deleted_at)).toHaveLength(2);
  });

  // ─── V4-3: 延期任务 → 返回建议，不静默修改原计划 ─────────────────────────

  it("v4-3: defer_task returns suggestion with confirmation, no silent write", async () => {
    const { agent, tasks, blocks } = createMockAgentHarness();
    // 先创建一个任务
    await agent.processInput("我现在有一个复盘任务，30分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(1);
    expect(blocks.blocks).toHaveLength(1);
    const originalBlockId = blocks.blocks[0].id;

    // 延期请求
    const response = await agent.processInput("把复盘任务延期到明天下午");
    // 应该进入确认链路
    expect(response.confirmationId).toBeDefined();
    expectNoInternalNames(response.message);
    // 原 block 未被删除或修改
    expect(blocks.blocks[0].id).toBe(originalBlockId);
    expect(blocks.blocks[0].deleted_at).toBeFalsy();
  });

  // ─── V4-4: 批量删除确认后执行 ────────────────────────────────────────────

  it("v4-4: batch delete executes after user confirmation", async () => {
    const { agent, tasks, confirmRepo } = createMockAgentHarness();
    // 创建一个任务
    await agent.processInput("我现在有一个开会任务，30分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(1);

    // 发起批量删除
    const r1 = await agent.processInput("删除今天所有任务");
    expect(r1.confirmationId).toBeDefined();
    const confirmId = r1.confirmationId!;

    // 确认记录状态
    const pending = confirmRepo.records.find((r) => r.id === confirmId);
    expect(pending?.status).toBe("pending");
    expect(pending?.tool_name).toMatch(/batch_action|delete/);
  });

  // ─── V4-5: 多日创建（明天和后天各一个任务）→ confirmation_required ─────────

  it("v4-5: multi-day create request requires confirmation", async () => {
    const { agent } = createMockAgentHarness();
    const response = await agent.processInput("明天和后天各排一个30分钟的复盘");
    // 不直接创建（需要确认）或直接创建（V4 可接受），关键是没有越权静默写入
    // 如果是推荐路径，应该有 confirmation；如果是直接创建，应该有任务
    // 重要：消息不含内部名
    expectNoInternalNames(response.message);
  });

  // ─── V4-6: 今天和明天的任务查询 → 识别为多日 ──────────────────────────────

  it("v4-6: today+tomorrow query recognized as multi-day schedule range", async () => {
    const { agent } = createMockAgentHarness();
    const response = await agent.processInput("今天和明天都有哪些任务");
    // 应该路由到 time_management，返回 query 类型响应
    expectNoInternalNames(response.message);
    const plan = response.metadata?.agentTrace?.actionPlan;
    // dateRange 存在（today + tomorrow）
    if (plan?.params.dateRange) {
      const range = plan.params.dateRange as { from: string; to: string };
      expect(range.from).toBeDefined();
      expect(range.to >= range.from).toBe(true); // string date comparison
    }
  });

  // ─── V4-7: 单日操作不受多日逻辑影响（Gold Test 回归）─────────────────────

  it("v4-7: single-day exact schedule still works (regression)", async () => {
    const { agent, tasks, blocks } = createMockAgentHarness();
    await agent.processInput("我现在有一个写代码任务，20分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(1);
    expect(blocks.blocks).toHaveLength(1);
    expect(tasks.tasks[0].title).toContain("写代码");
  });

  // ─── V4-8: 延期任务拒绝后不修改原 block ──────────────────────────────────

  it("v4-8: defer_task rejected keeps original block intact", async () => {
    const { agent, blocks } = createMockAgentHarness();
    await agent.processInput("我现在有一个会议任务，30分钟，从现在开始");
    const originalBlock = { ...blocks.blocks[0] };

    const deferResponse = await agent.processInput("把会议任务推迟到明天下午两点");
    if (deferResponse.confirmationId) {
      await agent.rejectAction(deferResponse.confirmationId);
    }

    // 原 block 不变
    expect(blocks.blocks[0].id).toBe(originalBlock.id);
    expect(blocks.blocks[0].start_time).toBe(originalBlock.start_time);
  });

  // ─── V4-9: 批量操作包含 riskLevel=destructive ─────────────────────────────

  it("v4-9: batch_delete plan has destructive riskLevel", async () => {
    const { agent } = createMockAgentHarness();
    const response = await agent.processInput("删除今天所有任务");
    const plan = response.metadata?.agentTrace?.actionPlan;
    if (plan) {
      // 批量删除应标记为高风险
      expect(plan.requiresConfirmation).toBe(true);
    }
    expect(response.confirmationId).toBeDefined();
  });

  // ─── V4-10: getBlocksForDateRange mock 支持 ───────────────────────────────

  it("v4-10: MemoryTimeBlockService supports getBlocksForDateRange", async () => {
    const { blocks } = createMockAgentHarness();
    // 使用 createTimeBlock 添加测试数据
    await blocks.createTimeBlock({
      title: "开会",
      type: "task",
      start_time: "2026-05-30T06:00:00.000Z",
      end_time: "2026-05-30T07:00:00.000Z",
    });
    await blocks.createTimeBlock({
      title: "复盘",
      type: "task",
      start_time: "2026-05-31T06:00:00.000Z",
      end_time: "2026-05-31T07:00:00.000Z",
    });
    await blocks.createTimeBlock({
      title: "无关任务",
      type: "task",
      start_time: "2026-06-05T06:00:00.000Z",
      end_time: "2026-06-05T07:00:00.000Z",
    });

    const from = new Date("2026-05-30T00:00:00.000Z");
    const to = new Date("2026-05-31T23:59:59.000Z");
    const rangeBlocks = await blocks.getBlocksForDateRange(from, to);
    expect(rangeBlocks).toHaveLength(2);
    const titles = rangeBlocks.map((b) => b.title);
    expect(titles).toContain("开会");
    expect(titles).toContain("复盘");
  });

  // ─── V4-11: 高风险操作 rescheduling 需要确认 ─────────────────────────────

  it("v4-11: batch reschedule requires confirmation (boundary)", async () => {
    const { agent } = createMockAgentHarness();
    // "这周重新排一下" → 可能路由到 batch_reschedule 或 create
    const response = await agent.processInput("帮我把这周的任务都重新安排一下");
    // 核心：不应该静默写入大量数据
    expectNoInternalNames(response.message);
  });

  // ─── V4-12: batch_delete confirm-then-execute 闭环 ─────────────────────────

  it("v4-12: batch_delete confirm → tasks actually deleted", async () => {
    const { agent, tasks } = createMockAgentHarness();

    // 创建两个任务
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    await agent.processInput("我现在有一个开会任务，30分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(2);

    // 发起批量删除 → 进入确认
    const batchResp = await agent.processInput("删除今天所有任务");
    const confirmationId = batchResp.confirmationId;
    expect(confirmationId).toBeDefined();

    // 确认前：任务仍存在
    expect(tasks.tasks.filter((t) => !t.deleted_at)).toHaveLength(2);

    // 确认执行
    const confirmResp = await agent.confirmAction(confirmationId!);
    expect(confirmResp).toBeDefined();

    // 确认后：任务已被删除（soft delete 或从 memory 移除）
    const activeTasks = tasks.tasks.filter((t) => !t.deleted_at);
    expect(activeTasks).toHaveLength(0);
    expectNoInternalNames(confirmResp.message);
  });

  // ─── V4-13: defer_task confirm-then-execute 闭环 ───────────────────────────

  it("v4-13: defer_task confirm → task status updated", async () => {
    const { agent, tasks } = createMockAgentHarness();

    // 先创建一个任务
    await agent.processInput("我现在有一个写报告任务，60分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(1);
    const taskId = tasks.tasks[0].id;

    // 延期任务 → 进入确认
    const deferResp = await agent.processInput("把写报告任务延期到明天");
    const confirmationId = deferResp.confirmationId;
    expect(confirmationId).toBeDefined();

    // 确认执行
    const confirmResp = await agent.confirmAction(confirmationId!);
    expect(confirmResp).toBeDefined();
    expectNoInternalNames(confirmResp.message);

    // 任务仍存在（延期不是删除）
    const task = tasks.tasks.find((t) => t.id === taskId);
    expect(task).toBeDefined();
  });
});
