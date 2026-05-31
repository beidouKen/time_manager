/**
 * agent_v5_recommendation.test.ts — Phase 4 Agent V5 Tests
 *
 * 验证 Phase 4 目标：
 *   - RecommendationHandler 基于 mock memory/rag 给出建议
 *   - detectScheduleDensity 密度检测
 *   - suggestion/confirmation_required/executable_action 三分类
 *   - MockNotificationAdapter 仅在 reminder 创建后收到事件
 *   - suggestion 路径不写库、不发通知
 *   - RAG/Memory 始终被 mock 隔离
 * 至少 10 条 mock test。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAgentHarness } from "@/agent/testing/createMockAgentHarness";
import { RecommendationHandler } from "@/agent/time-management/RecommendationHandler";
import { MockMemoryAdapter } from "@/agent/memory/MockMemoryAdapter";
import { MockRagAdapter } from "@/agent/memory/MockRagAdapter";

const NOW = "2026-05-30T04:00:00.000Z"; // UTC 04:00 = Asia/Shanghai 12:00

describe("Phase 4 Agent V5 Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── V5-1: MockMemoryAdapter 记录 schedule_task 成功后的行为 ──────────────

  it("v5-1: memory adapter records behavior after schedule_task success", async () => {
    const { agent, memory } = createMockAgentHarness();
    await agent.processInput("我现在有一个写作任务，30分钟，从现在开始");
    const records = memory.dump();
    // 应该有一条 task_scheduled 记录
    expect(records.length).toBeGreaterThanOrEqual(1);
    const scheduled = records.find((r) => r.type === "task_scheduled");
    expect(scheduled).toBeDefined();
    expect(scheduled?.title).toContain("写作");
  });

  // ─── V5-2: MockNotificationAdapter 在 reminder 创建后收到事件 ────────────

  it("v5-2: notifier receives event after reminder creation", async () => {
    const { agent, notifier } = createMockAgentHarness();
    await agent.processInput("下午两点提醒我开会");
    const events = notifier.drain();
    // 应该有一条 reminder 通知事件
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].channel).toBe("reminder");
    expect(events[0].title).toBeTruthy();
  });

  // ─── V5-3: suggestion 路径不发通知、不写库 ────────────────────────────────

  it("v5-3: suggestion path does not trigger notification or writes", async () => {
    const memory = new MockMemoryAdapter();
    const rag = new MockRagAdapter();
    const { tasks, blocks, notifier } = createMockAgentHarness({
      memoryAdapter: memory,
      ragAdapter: rag,
    });

    // 测试 RecommendationHandler 的 suggestion 路径
    const handler = new RecommendationHandler({
      memoryAdapter: memory,
      ragAdapter: rag,
    });
    const context = {
      currentDatetime: NOW,
      timezone: "Asia/Shanghai",
      recentMessages: [],
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
    };
    const result = await handler.generateRecommendation(context, [
      { title: "会议", start_time: NOW, end_time: new Date(Date.now() + 30 * 60000).toISOString() },
    ]);
    // 单个任务的建议 = suggestion 或 executable_action（低密度）
    expect(["suggestion", "executable_action"]).toContain(result.suggestionKind);
    expect(result.shouldNotify).toBe(false);

    // 确认没有副作用
    expect(tasks.tasks).toHaveLength(0);
    expect(blocks.blocks).toHaveLength(0);
    expect(notifier.peek()).toHaveLength(0);
  });

  // ─── V5-4: overload 场景 → confirmation_required 分类 ────────────────────

  it("v5-4: overload schedule produces confirmation_required suggestion", async () => {
    const handler = new RecommendationHandler({});
    const context = {
      currentDatetime: NOW,
      timezone: "Asia/Shanghai",
      recentMessages: [],
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
    };

    // 构建 overload 场景：8+ 个 block，每个 70 分钟
    const blocks = Array.from({ length: 9 }, (_, i) => ({
      title: `任务${i + 1}`,
      start_time: new Date(Date.now() + i * 70 * 60000).toISOString(),
      end_time: new Date(Date.now() + (i + 1) * 70 * 60000).toISOString(),
    }));

    const result = await handler.generateRecommendation(context, blocks);
    expect(result.suggestionKind).toBe("confirmation_required");
    expect(result.proposedAction).toBeDefined();
    expect(result.message).toMatch(/计划|安排|满|过载|建议/);
  });

  // ─── V5-5: 低完成率的 memory → Agent 给出 buffer 建议 ───────────────────

  it("v5-5: low completion rate in memory triggers buffer suggestion", async () => {
    const memory = new MockMemoryAdapter();
    // 注入低完成率历史（5 次排程，1 次完成，完成率 20%）
    for (let i = 0; i < 5; i++) {
      await memory.recordSchedule({ taskId: `t${i}`, title: "写作任务", category: "写作", estimatedMinutes: 60 });
    }
    await memory.recordTaskCompletion({ taskId: "t0", title: "写作任务", category: "写作" });

    const handler = new RecommendationHandler({ memoryAdapter: memory });
    const context = {
      currentDatetime: NOW,
      timezone: "Asia/Shanghai",
      recentMessages: [],
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
    };

    const result = await handler.generateRecommendation(context, []);
    // 低完成率应触发 buffer 建议
    expect(result.message).toMatch(/完成率|缓冲|buffer|建议|预留/i);
    // 建议不是 confirmation_required（只是提示）
    expect(result.suggestionKind).toBe("suggestion");
  });

  // ─── V5-6: RAG adapter 返回 snippet → 融入建议消息 ──────────────────────

  it("v5-6: rag snippet is incorporated into recommendation message", async () => {
    const rag = new MockRagAdapter();
    rag.setSnippets([
      { content: "过去三周写作类任务平均完成率 70%，建议减少每天写作时长。", relevance: 0.9 },
    ]);

    const handler = new RecommendationHandler({ ragAdapter: rag });
    const context = {
      currentDatetime: NOW,
      timezone: "Asia/Shanghai",
      recentMessages: [],
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
    };

    const result = await handler.generateRecommendation(context, []);
    expect(result.message).toContain("写作类任务");
  });

  // ─── V5-7: suggestion 响应不写库（via agent.processInput path）────────────

  it("v5-7: regular schedule writes to memory, but suggestion does not", async () => {
    const { agent, tasks, memory } = createMockAgentHarness();

    // 正常排程 → 写 task + memory
    await agent.processInput("我现在有一个开会任务，30分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(1);
    const scheduledRecords = memory.dump().filter((r) => r.type === "task_scheduled");
    expect(scheduledRecords.length).toBeGreaterThanOrEqual(1);

    // 查询计划 → 不写 task，不写 memory
    const prevMemoryCount = memory.dump().length;
    await agent.processInput("今天上午有什么任务");
    // memory 没有新增记录
    expect(memory.dump().length).toBe(prevMemoryCount);
    expect(tasks.tasks).toHaveLength(1); // no new tasks
  });

  // ─── V5-8: detectScheduleDensity 密度分类正确 ─────────────────────────────

  it("v5-8: detectScheduleDensity correctly classifies densities", () => {
    const handler = new RecommendationHandler({});

    // 低密度
    const low = handler.detectScheduleDensity([
      { title: "任务1", start_time: NOW, end_time: new Date(Date.now() + 30 * 60000).toISOString() },
    ]);
    expect(low.density).toBe("low");

    // 高密度（> 6h）
    const highBlocks = Array.from({ length: 4 }, (_, i) => ({
      title: `任务${i + 1}`,
      start_time: new Date(Date.now() + i * 100 * 60000).toISOString(),
      end_time: new Date(Date.now() + (i * 100 + 100) * 60000).toISOString(),
    }));
    const high = handler.detectScheduleDensity(highBlocks);
    expect(["high", "overload"]).toContain(high.density);

    // overload（8+ blocks）
    const overloadBlocks = Array.from({ length: 9 }, (_, i) => ({
      title: `任务${i + 1}`,
      start_time: new Date(Date.now() + i * 30 * 60000).toISOString(),
      end_time: new Date(Date.now() + (i + 1) * 30 * 60000).toISOString(),
    }));
    const overload = handler.detectScheduleDensity(overloadBlocks);
    expect(overload.density).toBe("overload");
  });

  // ─── V5-9: MockRagAdapter 不调用真实 fetch ───────────────────────────────

  it("v5-9: MockRagAdapter never calls real fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const rag = new MockRagAdapter();
    await rag.retrieveRelatedHistory("任意 query");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // ─── V5-10: reminder 不在 suggestion 路径下发通知 ─────────────────────────

  it("v5-10: suggestion-only response does not trigger notification", async () => {
    const { notifier } = createMockAgentHarness();

    // 普通 general_chat 不触发通知
    const { agent, notifier: notifier2 } = createMockAgentHarness();
    await agent.processInput("你是谁");
    expect(notifier2.peek()).toHaveLength(0);

    // 查询类操作不触发通知
    await agent.processInput("今天有什么任务");
    expect(notifier2.peek()).toHaveLength(0);

    // 仅 reminder 创建触发通知
    await agent.processInput("下午三点提醒我开会");
    const events = notifier2.drain();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].channel).toBe("reminder");
    
    // notifier 用于验证它与 notifier2 是不同实例
    expect(notifier.peek()).toHaveLength(0);
  });

  // ─── V5-11: 建议响应的三分类都在 RecommendationHandler 中可达 ──────────────

  it("v5-11: all three suggestionKind values are reachable", async () => {
    const handler = new RecommendationHandler({});
    const ctx = {
      currentDatetime: NOW,
      timezone: "Asia/Shanghai",
      recentMessages: [],
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
    };

    // executable_action: empty blocks
    const r1 = await handler.generateRecommendation(ctx, []);
    expect(r1.suggestionKind).toBe("executable_action");

    // confirmation_required: overload blocks
    const overloadBlocks = Array.from({ length: 9 }, (_, i) => ({
      title: `T${i}`,
      start_time: new Date(Date.now() + i * 60 * 60000).toISOString(),
      end_time: new Date(Date.now() + (i + 1) * 60 * 60000).toISOString(),
    }));
    const r2 = await handler.generateRecommendation(ctx, overloadBlocks);
    expect(r2.suggestionKind).toBe("confirmation_required");

    // suggestion: memory with low completion rate
    const memWithLowRate = new MockMemoryAdapter();
    for (let i = 0; i < 5; i++) {
      await memWithLowRate.recordSchedule({ taskId: `t${i}`, title: "写作", category: "写作" });
    }
    const handlerWithMem = new RecommendationHandler({ memoryAdapter: memWithLowRate });
    const r3 = await handlerWithMem.generateRecommendation(ctx, []);
    expect(r3.suggestionKind).toBe("suggestion");
  });
});
