/**
 * mock_smoke.test.ts — Phase 1 Mock 验证路径 Smoke Tests
 *
 * 验证统一 mock 基础设施可独立运行，不依赖真实 LLM / DB / 通知。
 * 覆盖 5 条 P0 smoke 路径。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAgentHarness } from "@/agent/testing/createMockAgentHarness";
import {
  expectNoInternalNames,
  expectConfirmationRequired,
} from "@/agent/testing/mockInput";

const NOW = "2026-05-30T04:00:00.000Z"; // UTC 04:00 = Asia/Shanghai 12:00

describe("Phase 1 Mock Smoke Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Smoke 1: 明确排程写入 task + block ────────────────────────────────────

  it("smoke-1: exact schedule writes 1 task and 1 block", async () => {
    const { agent, tasks, blocks } = createMockAgentHarness();
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(1);
    expect(blocks.blocks).toHaveLength(1);
    expect(tasks.tasks[0].title).toContain("写文档");
  });

  // ─── Smoke 2: 提醒请求进入 time_management 而非 general_chat ──────────────

  it("smoke-2: reminder input routes to time_management, not general_chat", async () => {
    const { agent, blocks } = createMockAgentHarness();
    const response = await agent.processInput("明天下午三点提醒我开会");
    // 提醒应创建 TimeBlock（type=event），不走 general_chat（general_chat 不写库）
    expect(blocks.blocks).toHaveLength(1);
    expect(blocks.blocks[0].type).toBe("event");
    // 响应中应有时间描述
    expect(response.message.length).toBeGreaterThan(0);
    expectNoInternalNames(response.message);
  });

  // ─── Smoke 3: 删除请求进入 confirmation_required，未删除 ──────────────────

  it("smoke-3: delete request returns confirmation_required, no task deleted", async () => {
    const { agent, tasks } = createMockAgentHarness();
    // 先创建一个任务
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(1);

    // 然后发送删除请求
    const response = await agent.processInput("删除写文档任务");
    // 必须有 confirmationId（confirmation_required）
    expectConfirmationRequired(response, 0, 0);
    // 但 tasks 仍然存在（未删除）
    const activeTasks = tasks.tasks.filter((t) => !t.deleted_at);
    expect(activeTasks).toHaveLength(1);
  });

  // ─── Smoke 4: Mock store 写入只通过 ToolRouter 链路 ───────────────────────

  it("smoke-4: mock store write only happens via ToolRouter chain, not bypass", async () => {
    const { agent, tasks, blocks, logs } = createMockAgentHarness();

    // 执行明确排程
    await agent.processInput("我现在有一个开会任务，30分钟，从现在开始");

    // 验证写入发生
    expect(tasks.tasks).toHaveLength(1);
    expect(blocks.blocks).toHaveLength(1);

    // 验证有 action log 记录（写库必须经过 log → ToolRouter 链路）
    const successLogs = logs.entries.filter((e) => e.status === "success");
    expect(successLogs.length).toBeGreaterThan(0);

    // 验证 log 中有 toolName（说明经过 ToolRouter 而非旁路）
    const toolLog = logs.entries.find((e) => e.toolName === "schedule_task");
    expect(toolLog).toBeDefined();
  });

  // ─── Smoke 5: ResponseBoundary 输出不含内部名 ─────────────────────────────

  it("smoke-5: ResponseBoundary output does not contain internal names", async () => {
    const { agent } = createMockAgentHarness();

    const inputs = [
      "我现在有一个写文档任务，10分钟，从现在开始",
      "删除写文档任务",
      "帮我安排一个开会任务，30分钟",
      "今天上海天气怎么样",
      "你是谁",
      "?",
    ];

    for (const input of inputs) {
      const response = await agent.processInput(input);
      expectNoInternalNames(response.message);
    }
  });
});
