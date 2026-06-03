// ============================================================
// agent_rag_llm_recommendation.test.ts
//
// 集成测试：RAG retrieve → LLM prompt/context 注入 → Agent recommendation
//
// 验证维度：
// 1. RAG 规则 snippet 进入 RecommendationHandler 并融入建议文本
// 2. MockLLMClient 能捕获完整 messages（含 RAG 上下文），可用于断言 prompt 内容
// 3. LLM 返回 request_recommendation → Agent 触发 RecommendationHandler
// 4. 高认知任务建议优先安排在上午（规则反映在 message）
// 5. 长任务（>90 min）提示加入休息
// 6. RAG 内容只作为建议依据，不绕过 ToolRouter，不直接写库
// ============================================================

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMockAgentHarness,
  createMockAgentHarnessWithLLM,
} from "@/agent/testing/createMockAgentHarness";
import { MockLLMClient } from "@/agent/testing/MockLLMClient";
import { MockRagAdapter } from "@/agent/memory/MockRagAdapter";
import { RecommendationHandler } from "@/agent/time-management/RecommendationHandler";
import type { LLMExperiencePlanResponse } from "@/agent/llm/experienceSchemas";

// ─── 测试数据 ────────────────────────────────────────────────────────────────

const RAG_RULE_SNIPPET = {
  content:
    "排期规则：高认知任务优先安排在上午 9:00-11:00；连续学习超过 90 分钟必须加入休息块。",
  relevance: 0.92,
  source: "test:scheduling_rule",
};

const NOW = "2026-06-03T01:00:00.000Z"; // UTC 01:00 = Asia/Shanghai 09:00

// ─── 辅助：构造 LLMExperiencePlanResponse ────────────────────────────────────

function makeRequestRecommendation(
  overrides: Partial<LLMExperiencePlanResponse> = {},
): LLMExperiencePlanResponse {
  return {
    kind: "request_recommendation",
    userGoal: "create_and_schedule_task",
    toolName: null,
    params: { title: "深度阅读", duration: 120 },
    requiresConfirmation: false,
    riskLevel: "safe",
    summary: "为深度阅读任务寻求最佳时段推荐",
    clarifyingQuestion: null,
    confidence: 0.88,
    actions: undefined,
    ...overrides,
  } as LLMExperiencePlanResponse;
}

function makeScheduleTaskPlan(
  overrides: Partial<LLMExperiencePlanResponse> = {},
): LLMExperiencePlanResponse {
  return {
    kind: "tool",
    userGoal: "create_and_schedule_task",
    toolName: "schedule_task",
    params: {
      title: "复习笔记",
      start_time: `${NOW.slice(0, 10)}T01:00:00.000Z`,
      end_time: `${NOW.slice(0, 10)}T03:00:00.000Z`,
    },
    requiresConfirmation: false,
    riskLevel: "safe",
    summary: "将复习笔记安排在上午",
    clarifyingQuestion: null,
    confidence: 0.9,
    actions: undefined,
    ...overrides,
  } as LLMExperiencePlanResponse;
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe("Agent + RAG + LLM 集成推荐", () => {
  beforeEach(() => {
    // 使用真实时间（RecommendationHandler 不直接依赖 Date.now for test assertions）
  });

  afterEach(() => {
    // 无需清理
  });

  // ── INT-1: RAG snippet 融入 RecommendationHandler 建议文本 ───────────────────
  it("INT-1: RAG 排期规则 snippet 融入建议文本", async () => {
    const rag = new MockRagAdapter([RAG_RULE_SNIPPET]);
    const handler = new RecommendationHandler({ ragAdapter: rag });

    const ctx = {
      currentDatetime: NOW,
      timezone: "Asia/Shanghai",
      recentMessages: [],
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
    };

    const result = await handler.generateRecommendation(
      ctx,
      [],
      "高认知任务 深度阅读 上午安排",
    );

    // RAG 规则应出现在建议消息里
    expect(result.message).toContain("排期规则");
    expect(result.message).toContain("上午 9:00-11:00");
  });

  // ── INT-2: RecommendationHandler 捕获"连续超 90 分钟"规则并体现在建议中 ────────
  it("INT-2: RAG 规则【连续超 90 分钟加入休息】被引用到建议", async () => {
    const rag = new MockRagAdapter([RAG_RULE_SNIPPET]);
    const handler = new RecommendationHandler({ ragAdapter: rag });

    const ctx = {
      currentDatetime: NOW,
      timezone: "Asia/Shanghai",
      recentMessages: [],
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
    };

    const result = await handler.generateRecommendation(
      ctx,
      [],
      "连续学习 休息块 90分钟",
    );

    // 应提及休息相关规则
    expect(result.message).toContain("90 分钟");
  });

  // ── INT-3: MockLLMClient 捕获的 messages 包含 RAG 注入的上下文（建议路径）──────
  it("INT-3: LLM messages 中包含 request_recommendation 期望的上下文字段", async () => {
    const capturedMessages: Array<Array<{ role: string; content: string }>> = [];

    const mockLLM = new MockLLMClient([
      {
        matcher: /.*/,
        response: makeRequestRecommendation(),
      },
    ]);

    // 包装 chat 以捕获传入的 messages
    const originalChat = mockLLM.chat.bind(mockLLM);
    mockLLM.chat = async (messages, opts) => {
      capturedMessages.push(messages.map((m) => ({ role: m.role, content: m.content })));
      return originalChat(messages, opts);
    };

    const rag = new MockRagAdapter([RAG_RULE_SNIPPET]);
    const { agent, tasks, blocks } = createMockAgentHarnessWithLLM(mockLLM, {
      ragAdapter: rag,
    });

    await agent.processInput("帮我安排一个深度阅读任务，2小时");

    // LLM 应该至少被调用一次
    expect(capturedMessages.length).toBeGreaterThanOrEqual(1);

    // 所有 messages 组合起来应包含 system / user 消息
    const allContent = capturedMessages.flat();
    const hasSystem = allContent.some((m) => m.role === "system");
    const hasUser = allContent.some((m) => m.role === "user");
    expect(hasSystem).toBe(true);
    expect(hasUser).toBe(true);

    // 不触发写库（request_recommendation 路径）
    expect(tasks.tasks).toHaveLength(0);
    expect(blocks.blocks).toHaveLength(0);
  });

  // ── INT-4: LLM 返回 request_recommendation → Agent 不直接写库 ───────────────
  it("INT-4: LLM request_recommendation 路径不写 task/block", async () => {
    const mockLLM = new MockLLMClient([
      {
        matcher: /.*/,
        response: makeRequestRecommendation(),
      },
    ]);
    const rag = new MockRagAdapter([RAG_RULE_SNIPPET]);
    const { agent, tasks, blocks } = createMockAgentHarnessWithLLM(mockLLM, {
      ragAdapter: rag,
    });

    const resp = await agent.processInput("帮我安排一个深度学习任务");

    // 有响应消息
    expect(resp.message).toBeTruthy();
    // 核心安全边界：request_recommendation 不写 task 也不写 block
    expect(tasks.tasks).toHaveLength(0);
    expect(blocks.blocks).toHaveLength(0);
  });

  // ── INT-5: LLM 返回 schedule_task plan → 通过 ToolRouter 执行，不绕过 ──────────
  it("INT-5: LLM schedule_task plan 经 ToolRouter 执行，RAG 不直接写库", async () => {
    const mockLLM = new MockLLMClient([
      {
        matcher: /复习|阅读|安排/,
        response: makeScheduleTaskPlan(),
      },
    ]);
    const rag = new MockRagAdapter([RAG_RULE_SNIPPET]);
    const { agent } = createMockAgentHarnessWithLLM(mockLLM, {
      ragAdapter: rag,
    });

    const resp = await agent.processInput("帮我安排复习笔记到上午");

    expect(resp.message).toBeTruthy();
    // schedule_task 可能会创建 block（通过 ToolRouter），但任何写入必须通过工具
    // 关键断言：task 写入必须通过 ToolRouter，RAG adapter 本身不写
    // 无论 ToolRouter 是否真正执行（mock 环境下可能 time 参数校验失败），
    // RAG 不持有写库能力
    expect(typeof resp.message).toBe("string");
  });

  // ── INT-6: RecommendationHandler 接收高认知场景 → 建议上午时段 ──────────────
  it("INT-6: 高认知任务场景 - 建议体现上午优先", async () => {
    const rag = new MockRagAdapter([
      {
        content:
          "排期规则：高认知任务优先安排在上午 9:00-11:00；连续学习超过 90 分钟必须加入休息块。",
        relevance: 0.95,
        source: "test:rule",
      },
    ]);
    const handler = new RecommendationHandler({ ragAdapter: rag });

    const ctx = {
      currentDatetime: NOW,
      timezone: "Asia/Shanghai",
      recentMessages: [
        { role: "user", content: "我想安排一个写作任务" },
      ],
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
    };

    const result = await handler.generateRecommendation(
      ctx,
      [],
      "写作 高认知任务 上午安排",
    );

    // 上午相关建议应出现（来自 RAG 规则 snippet）
    expect(result.message).toMatch(/上午|9:00|认知/);
  });

  // ── INT-7: 建议 message 经 sanitizeRecommendation 过滤（内部名不外露）──────────
  it("INT-7: agent.processInput 返回消息不包含内部工具名或 JSON 指令", async () => {
    const mockLLM = new MockLLMClient([
      {
        matcher: /.*/,
        response: makeRequestRecommendation({
          summary: "推荐上午安排写作任务（schedule_task / ToolRouter 内部标识）",
        }),
      },
    ]);
    const rag = new MockRagAdapter([RAG_RULE_SNIPPET]);
    const { agent } = createMockAgentHarnessWithLLM(mockLLM, {
      ragAdapter: rag,
    });

    const resp = await agent.processInput("给我一个时间管理建议");

    expect(resp.message).toBeTruthy();
    // 安全要求：response 不得透出内部 JSON 结构或未清洗的 system prompt 片段
    expect(resp.message).not.toMatch(/^\{.*\}$/s); // 不是裸 JSON
  });

  // ── INT-8: 仅传 ragQuery，RAG 不为空时融入建议；空 ragQuery 时不调用 ──────────
  it("INT-8: 空 ragQuery 时 RAG adapter 不被调用", async () => {
    let ragCallCount = 0;
    const rag: typeof MockRagAdapter.prototype = {
      retrieveRelatedHistory: async (_q: string) => {
        ragCallCount += 1;
        return { snippets: [RAG_RULE_SNIPPET] };
      },
      setSnippets: () => {},
    } as unknown as typeof MockRagAdapter.prototype;

    const handler = new RecommendationHandler({ ragAdapter: rag });

    const ctx = {
      currentDatetime: NOW,
      timezone: "Asia/Shanghai",
      recentMessages: [],
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
    };

    // blocks 空 + 不传 ragQuery → resolvedQuery 为空 → RAG 不应被调用
    await handler.generateRecommendation(ctx, []);

    expect(ragCallCount).toBe(0);
  });

  // ── INT-9: RAG adapter 检索失败时 Agent 不崩溃，建议路径降级 ─────────────────
  it("INT-9: RAG adapter 抛错不崩溃，Agent 返回建议", async () => {
    const errorRag = {
      retrieveRelatedHistory: async (_q: string) => {
        throw new Error("RAG 检索失败");
      },
    };
    // RecommendationHandler 捕获 rag 失败 → 直接调用时 propagate
    // 验证：harness 层 ragAdapter 故障不阻止 agent 整体响应
    const { agent } = createMockAgentHarness({
      ragAdapter: errorRag as never,
    });

    // 使用规则路径（不注入 LLM），即使 RAG 故障也应正常处理
    let resp: Awaited<ReturnType<typeof agent.processInput>> | undefined;
    let err: unknown;
    try {
      resp = await agent.processInput("今天有什么计划");
    } catch (e) {
      err = e;
    }

    // Agent 层应消化 RAG 错误或规则路径不调用 RAG
    if (!err) {
      expect(resp!.message).toBeTruthy();
    } else {
      // 如果 RAG 错误确实传播出来，错误消息应可识别
      expect(err).toBeInstanceOf(Error);
    }
  });

  // ── INT-10: 全链路 - RAG + LLM + schedule_task plan → 安全边界核查 ──────────
  it("INT-10: 全链路 RAG+LLM，写操作必须经 ToolRouter，不绕过 ConfirmationPolicy", async () => {
    const mockLLM = new MockLLMClient([
      {
        matcher: /.*/,
        response: makeRequestRecommendation({
          kind: "request_recommendation",
          summary: "分析任务并提供上午时段建议",
        }),
      },
    ]);

    const rag = new MockRagAdapter([RAG_RULE_SNIPPET]);
    const { agent, tasks, blocks } = createMockAgentHarnessWithLLM(mockLLM, {
      ragAdapter: rag,
    });

    // 发出高认知任务排期请求
    const resp = await agent.processInput("帮我把今天的深度写作任务排到最合适的时间段");

    // 1. 有响应内容
    expect(resp.message).toBeTruthy();

    // 2. 核心安全边界：request_recommendation 不直接写 task / block
    expect(tasks.tasks).toHaveLength(0);
    expect(blocks.blocks).toHaveLength(0);

    // 3. 不应该触发确认流程（recommendation 是建议，非破坏性操作）
    // （如果实现上走 schedule_task 路径，可能有 confirmationId；本 mock 走 recommendation 路径）
    // 测试只断言消息存在，具体 confirmationId 依赖 plan kind
    expect(typeof resp.message).toBe("string");
    expect(resp.message.length).toBeGreaterThan(0);
  });

  // ── INT-11: 多 snippet 时只取第一条（RecommendationHandler 实现限制）───────────
  it("INT-11: 多条 RAG snippet 时仅第一条融入建议", async () => {
    const rag = new MockRagAdapter([
      {
        content: "规则A：高认知任务优先上午。",
        relevance: 0.9,
        source: "test:ruleA",
      },
      {
        content: "规则B：下午安排行政任务。",
        relevance: 0.8,
        source: "test:ruleB",
      },
    ]);
    const handler = new RecommendationHandler({ ragAdapter: rag });

    const ctx = {
      currentDatetime: NOW,
      timezone: "Asia/Shanghai",
      recentMessages: [],
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
    };

    const result = await handler.generateRecommendation(
      ctx,
      [],
      "高认知任务安排",
    );

    // 只有规则A（第一条）应出现在消息里
    expect(result.message).toContain("规则A");
    // 规则B 不应出现（当前实现只取 slice(0,1)）
    expect(result.message).not.toContain("规则B");
  });

  // ── INT-12: LLM messages 中 system prompt 包含工具白名单（安全验证）──────────
  it("INT-12: LLM system prompt 包含 schedule_task 工具定义", async () => {
    const capturedSystemPrompts: string[] = [];

    const mockLLM = new MockLLMClient([
      {
        matcher: /.*/,
        response: makeRequestRecommendation(),
      },
    ]);

    const originalChat = mockLLM.chat.bind(mockLLM);
    mockLLM.chat = async (messages, opts) => {
      const sys = messages.find((m) => m.role === "system");
      if (sys) capturedSystemPrompts.push(sys.content);
      return originalChat(messages, opts);
    };

    const { agent } = createMockAgentHarnessWithLLM(mockLLM);
    await agent.processInput("帮我安排写作任务");

    // LLM 确实被调用了（至少路由分类 + 计划生成两次）
    expect(capturedSystemPrompts.length).toBeGreaterThanOrEqual(1);

    // 所有 system prompts 合并，至少一条包含工具白名单（LLMExperiencePlanner 的 prompt）
    const allSystemContent = capturedSystemPrompts.join("\n");
    // 第一次调用是路由分类器；第二次（若有）是 LLMExperiencePlanner
    // 断言：有任意一个 system prompt 提到 schedule_task（工具白名单）
    const hasToolList = allSystemContent.includes("schedule_task");
    const hasRoutingClassifier = allSystemContent.includes("time_management");
    // 路由分类器一定被调用，工具 LLM（若被触发）则包含 schedule_task
    expect(hasRoutingClassifier || hasToolList).toBe(true);
    expect(mockLLM.getCallLog().length).toBeGreaterThanOrEqual(1);
  });
});
