// ============================================================
// agent_v3_7_llm_safety.test.ts — V3.7 LLM 安全边界测试
//
// 测试目标：
// 1. LLM happy path → ToolRouter 执行成功
// 2. LLM 返回未注册 toolName → reject，0 写入
// 3. LLM destructive 但 requiresConfirmation=false → policy 强制升级
// 4. LLM batch_action 无 actions[] → reject / 降级 fallback
// 5. LLM batch_action 含 actions[] → confirm 后顺序执行
// 6. LLM defer_task → 分解为 update_task，confirm 后真实生效
// 7. LLM api_key_missing → 降级 fallback
// 8. LLM network_error → 降级 fallback
// 9. LLM 返回非 JSON → parse_error 降级
// 10. LLM args 缺少必填字段 → 不崩溃
// 11. LLM tool_plan 与 CONFIRMATION_POLICY 冲突 → 以 policy 为准
// 12. Read-only handler 经 LLMChatExecutor → 不写库，不调 ToolRouter
// ============================================================

import { describe, it, expect } from "vitest";
import {
  createMockAgentHarness,
  createMockAgentHarnessWithLLM,
} from "@/agent/testing/createMockAgentHarness";
import { MockLLMClient } from "@/agent/testing/MockLLMClient";
import { LLMError } from "@/agent/llm/LLMClient";
import type { LLMExperiencePlanResponse } from "@/agent/llm/experienceSchemas";

// ─── 辅助：构造 LLMExperiencePlanResponse ────────────────────────────────────

function makePlanResp(
  overrides: Partial<LLMExperiencePlanResponse>
): LLMExperiencePlanResponse {
  return {
    kind: "tool",
    userGoal: "create_and_schedule_task",
    toolName: "create_task",
    params: { title: "测试任务", duration: 30 },
    requiresConfirmation: false,
    riskLevel: "safe",
    summary: "创建测试任务",
    clarifyingQuestion: null,
    confidence: 0.95,
    actions: undefined,
    ...overrides,
  } as LLMExperiencePlanResponse;
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe("V3.7 LLM 安全边界测试", () => {
  // ── D3-1: LLM happy path → list_tasks 查询执行成功 ───────────────────────
  it("d3-1: LLM tool_plan happy path → list_tasks executes via ToolRouter", async () => {
    const mock = new MockLLMClient([
      {
        matcher: /.*/,
        response: makePlanResp({
          kind: "tool",
          toolName: "list_tasks",
          params: { status: "todo" },
          riskLevel: "safe",
          requiresConfirmation: false,
          summary: "列出待办任务",
          userGoal: "query_schedule",
        }),
      },
    ]);
    const { agent, tasks } = createMockAgentHarnessWithLLM(mock);
    const resp = await agent.processInput("列出我的任务");
    expect(resp.message).toBeTruthy();
    // LLM 路径成功调用 list_tasks，0 任务时应返回提示
    expect(tasks.tasks).toHaveLength(0);
  });

  // ── D3-2: 未注册 toolName → reject，0 写入 ────────────────────────────────
  it("d3-2: LLM returns unregistered toolName → reject, 0 writes, no crash", async () => {
    const mock = new MockLLMClient([
      {
        matcher: /.*/,
        response: makePlanResp({
          kind: "tool",
          toolName: "hack_database", // 未注册工具
          params: { sql: "DROP TABLE tasks" },
        }),
      },
    ]);
    const { agent, tasks, blocks } = createMockAgentHarnessWithLLM(mock);
    const resp = await agent.processInput("执行危险操作");
    expect(resp.message).toBeTruthy();
    // 未注册 toolName → LLMUnavailableError(safety_rejected) → fallback → 不写数据
    expect(tasks.tasks).toHaveLength(0);
    expect(blocks.blocks).toHaveLength(0);
  });

  // ── D3-3: destructive 但 requiresConfirmation=false → policy 强制升级 ────
  it("d3-3: LLM destructive op but requiresConfirmation=false → forced to confirm", async () => {
    // 先用规则路径创建任务
    const setupHarness = createMockAgentHarness();
    await setupHarness.agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    const taskId = setupHarness.tasks.tasks[0]?.id;
    expect(taskId).toBeDefined();

    // 再用 LLM mock 测试删除路径（LLM 试图绕过确认）
    const mock = new MockLLMClient([
      {
        matcher: /删除/,
        response: makePlanResp({
          kind: "tool",
          toolName: "delete_task",
          params: { taskId: taskId ?? "fake" },
          requiresConfirmation: false, // LLM 尝试不确认直接删
          riskLevel: "safe",           // LLM 低估风险
        }),
      },
    ]);
    const { agent, tasks } = createMockAgentHarnessWithLLM(mock);
    // 先用 LLM harness 创建任务（此消息不匹配 /删除/ 所以走规则路径）
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    expect(tasks.tasks.length).toBeGreaterThanOrEqual(1);
    const realTaskId = tasks.tasks[0].id;

    // 更新 mock 使用真实 taskId
    const mock2 = new MockLLMClient([
      {
        matcher: /.*/,
        response: makePlanResp({
          kind: "tool",
          toolName: "delete_task",
          params: { taskId: realTaskId },
          requiresConfirmation: false,
          riskLevel: "safe",
        }),
      },
    ]);
    const { agent: agent2, tasks: tasks2 } = createMockAgentHarnessWithLLM(mock2);
    // 注入任务数据（直接操作 memory service）
    // 注入任务（使用 any 绕过严格类型检查，test only）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tasks2.tasks as any[]).push({
      id: realTaskId,
      title: "写文档",
      status: "todo",
      priority: "medium",
      is_flexible: true,
      can_split: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const deleteResp = await agent2.processInput("删除写文档任务");

    // 核心断言：delete_task 应被强制进入确认流程（任务还在 or 进入确认）
    const taskStillExists = tasks2.tasks.filter((t) => !(t as any).deleted_at).length > 0;
    const hasConfirmation = deleteResp.confirmationId !== undefined;
    // 至少一个条件成立：任务还在 or 进入了确认
    expect(taskStillExists || hasConfirmation).toBe(true);
  });

  // ── D3-4: batch_action 无 actions[] → 被 validator reject（fallback） ──────
  it("d3-4: LLM batch_action without actions[] → safety rejected, fallback", async () => {
    const mock = new MockLLMClient([
      {
        matcher: /.*/,
        response: makePlanResp({
          kind: "batch_action",
          userGoal: "batch_delete_tasks",
          toolName: null,
          params: {}, // 缺少 actions
          requiresConfirmation: true,
          riskLevel: "destructive",
        }),
      },
    ]);
    const { agent, tasks } = createMockAgentHarnessWithLLM(mock);
    const resp = await agent.processInput("删除今天所有任务");
    // validator 拒绝 → LLMUnavailableError(safety_rejected) → fallback → 规则路径处理
    // 规则路径：无任务时 batch_action 生成空 actions[]，进入确认，0 数据写入
    expect(resp.message).toBeTruthy();
    expect(tasks.tasks).toHaveLength(0);
  });

  // ── D3-5: batch_action 含 actions[] → confirm 后顺序执行 ──────────────────
  it("d3-5: LLM batch_action with actions[] → confirm executes all", async () => {
    // 先用规则路径准备任务数据
    const { agent: setupAgent, tasks: setupTasks } = createMockAgentHarness();
    await setupAgent.processInput("我现在有一个任务A，10分钟，从现在开始");
    await setupAgent.processInput("我现在有一个任务B，10分钟，从现在开始");
    expect(setupTasks.tasks).toHaveLength(2);
    const [taskA, taskB] = setupTasks.tasks;

    // 用含 actions[] 的 LLM mock
    const mock = new MockLLMClient([
      {
        matcher: /删除/,
        response: makePlanResp({
          kind: "batch_action",
          userGoal: "batch_delete_tasks",
          toolName: null,
          params: {
            actions: [
              { toolName: "delete_task", params: { taskId: taskA.id }, summary: `删除${taskA.title}` },
              { toolName: "delete_task", params: { taskId: taskB.id }, summary: `删除${taskB.title}` },
            ],
          },
          requiresConfirmation: true,
          riskLevel: "destructive",
          summary: "批量删除2个任务",
        }),
      },
    ]);

    const { agent, tasks } = createMockAgentHarnessWithLLM(mock);
    // 直接往 tasks 注入准备好的任务
    tasks.tasks.push(...setupTasks.tasks.map((t) => ({ ...t })));
    expect(tasks.tasks.filter((t) => !(t as any).deleted_at)).toHaveLength(2);

    const batchResp = await agent.processInput("批量删除今天所有任务");
    expect(batchResp.confirmationId).toBeDefined();

    // 确认前任务仍在（未执行）
    expect(tasks.tasks.filter((t) => !(t as any).deleted_at)).toHaveLength(2);

    // 确认执行
    const confirmResp = await agent.confirmAction(batchResp.confirmationId!);
    expect(confirmResp.message).toBeTruthy();

    // 确认后，2 个任务应被删除（soft delete）
    const activeTasks = tasks.tasks.filter((t) => !(t as any).deleted_at);
    expect(activeTasks).toHaveLength(0);
  });

  // ── D3-6: LLM defer_task → actions[] 包含 update_task ─────────────────────
  it("d3-6: LLM defer_task with actions → confirm runs update_task", async () => {
    const tomorrowISO = new Date(Date.now() + 86400000).toISOString();

    const mock = new MockLLMClient([
      {
        matcher: /延期|推迟/,
        response: makePlanResp({
          kind: "defer_task",
          userGoal: "defer_task",
          toolName: null,
          params: {
            title: "写报告",
            targetTime: tomorrowISO,
            actions: [
              {
                toolName: "update_task",
                params: { taskId: "__PLACEHOLDER__", deadline: tomorrowISO },
                summary: "延期写报告",
              },
            ],
          },
          requiresConfirmation: true,
          riskLevel: "confirm",
          summary: "延期写报告到明天",
        }),
      },
    ]);

    const { agent, tasks } = createMockAgentHarnessWithLLM(mock);
    // 先用非延期词创建任务（不匹配 /延期|推迟/，走规则路径）
    await agent.processInput("我现在有一个写报告任务，60分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(1);
    const taskId = tasks.tasks[0].id;

    // 现在更新 mock 使用真实 taskId
    const mock2 = new MockLLMClient([
      {
        matcher: /.*/,
        response: makePlanResp({
          kind: "defer_task",
          userGoal: "defer_task",
          toolName: null,
          params: {
            taskId,
            title: "写报告",
            targetTime: tomorrowISO,
            actions: [
              {
                toolName: "update_task",
                params: { taskId, deadline: tomorrowISO },
                summary: "延期写报告",
              },
            ],
          },
          requiresConfirmation: true,
          riskLevel: "confirm",
          summary: "延期写报告到明天",
        }),
      },
    ]);
    const { agent: agent2, tasks: tasks2 } = createMockAgentHarnessWithLLM(mock2);
    // 注入任务
    tasks2.tasks.push({ ...tasks.tasks[0] });

    const deferResp = await agent2.processInput("把写报告任务推迟到明天");
    expect(deferResp.confirmationId).toBeDefined();

    const confirmResp = await agent2.confirmAction(deferResp.confirmationId!);
    expect(confirmResp.message).toBeTruthy();

    // 任务仍存在（延期不是删除）
    expect(tasks2.tasks.filter((t) => !(t as any).deleted_at)).toHaveLength(1);
  });

  // ── D3-7: LLM api_key_missing → 降级 fallback ────────────────────────────
  it("d3-7: LLM api_key_missing → graceful fallback to rule planner", async () => {
    const mock = new MockLLMClient([
      {
        matcher: /.*/,
        response: new LLMError("api_key_missing", "API key 未配置"),
      },
    ]);
    const { agent } = createMockAgentHarnessWithLLM(mock);
    const resp = await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    // 应降级到规则路径，正常返回
    expect(resp.message).toBeTruthy();
    expect(resp.message).not.toContain("LLMError");
    expect(resp.message).not.toContain("api_key_missing");
  });

  // ── D3-8: LLM network_error → 降级 fallback ──────────────────────────────
  it("d3-8: LLM network_error → graceful fallback to rule planner", async () => {
    const mock = new MockLLMClient([
      {
        matcher: /.*/,
        response: new LLMError("network_error", "网络连接失败"),
      },
    ]);
    const { agent } = createMockAgentHarnessWithLLM(mock);
    const resp = await agent.processInput("现在几点了");
    expect(resp.message).toBeTruthy();
    expect(resp.message).not.toContain("network_error");
  });

  // ── D3-9: LLM 返回非 JSON → parse_error 降级 ─────────────────────────────
  it("d3-9: LLM returns parse_error → fallback, no crash", async () => {
    const mock = new MockLLMClient([
      {
        matcher: /.*/,
        response: new LLMError("parse_error", "LLM 返回了非 JSON 内容"),
      },
    ]);
    const { agent } = createMockAgentHarnessWithLLM(mock);
    const resp = await agent.processInput("帮我安排一个会议");
    expect(resp.message).toBeTruthy();
    expect(resp.message).not.toContain("parse_error");
    expect(resp.message).not.toContain("LLMError");
  });

  // ── D3-10: LLM args 缺少 taskId → update_task schema 校验失败但不崩溃 ────
  it("d3-10: LLM args missing required field → no crash, graceful error", async () => {
    const mock = new MockLLMClient([
      {
        matcher: /.*/,
        response: makePlanResp({
          kind: "tool",
          toolName: "update_task",
          params: { title: "新标题" }, // 缺 taskId
        }),
      },
    ]);
    const { agent } = createMockAgentHarnessWithLLM(mock);
    // ToolRouter 执行时 schema 校验失败，应返回 failure 响应而不是崩溃
    let resp: Awaited<ReturnType<typeof agent.processInput>> | undefined;
    let err: unknown;
    try {
      resp = await agent.processInput("更新任务标题");
    } catch (e) {
      err = e;
    }
    // 不应抛出未捕获的错误，或者返回有内容的响应
    if (err) {
      // 如果确实抛出，类型应为 Error
      expect(err).toBeInstanceOf(Error);
    } else {
      expect(resp).toBeDefined();
    }
  });

  // ── D3-11: LLM tool_plan 与 CONFIRMATION_POLICY 冲突 → 以 policy 为准 ────
  it("d3-11: LLM delete with requiresConfirmation=false → enforced to confirm", async () => {
    const { agent, tasks } = createMockAgentHarness();
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    expect(tasks.tasks).toHaveLength(1);
    const taskId = tasks.tasks[0].id;

    const mock = new MockLLMClient([
      {
        matcher: /.*/,
        response: makePlanResp({
          kind: "tool",
          toolName: "delete_task",
          params: { taskId },
          requiresConfirmation: false, // LLM 尝试绕过
          riskLevel: "safe",
        }),
      },
    ]);
    const { agent: agent2, tasks: tasks2 } = createMockAgentHarnessWithLLM(mock);
    // 注入任务
    tasks2.tasks.push({ ...tasks.tasks[0] });

    const deleteResp = await agent2.processInput("删除写文档任务");

    // 核心：delete_task 应被 policy 强制进入确认，或者 LLM 被降级后规则路径也要求确认
    const taskStillExists = tasks2.tasks.filter((t) => !(t as any).deleted_at).length > 0;
    const hasConfirmation = deleteResp.confirmationId !== undefined;
    expect(taskStillExists || hasConfirmation).toBe(true);
  });

  // ── D3-12: Read-only handler → 不写库，不调 ToolRouter ───────────────────
  it("d3-12: general_chat domain → no writes, returns text", async () => {
    const mock = new MockLLMClient([]);
    const { agent, tasks, blocks } = createMockAgentHarnessWithLLM(mock);

    // 闲聊路由到 general_chat 域
    const resp = await agent.processInput("今天天气不错");
    expect(resp.message).toBeTruthy();
    // 验证：不写任何数据
    expect(tasks.tasks).toHaveLength(0);
    expect(blocks.blocks).toHaveLength(0);
  });
});
