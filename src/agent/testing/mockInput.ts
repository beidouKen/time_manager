// ============================================================
// mockInput.ts — Mock 测试断言工具集
//
// 提供常用的测试输入构造和断言辅助函数。
// ============================================================

import { expect } from "vitest";
import type { AgentResponse } from "@/agent/AgentService";
import type { AgentRefreshHints } from "@/agent/types";

/** 内部名黑名单（与 ResponseBoundary.ts 的 INTERNAL_NAME_PATTERN 对齐） */
const INTERNAL_NAMES = [
  "userGoal",
  "toolName",
  "ActionPlanner",
  "ToolRouter",
  "LLMPlanner",
  "processWith",
  "SemanticFrameParser",
  "AgentDomainRouter",
  "semantic_frame",
  "request_recommendation",
  "delete_task",
  "create_reminder",
  "create_and_schedule_task",
  "query_schedule",
  "ask_current_time",
  "unsupported_intent",
  "general_chat",
  "tool_success",
  "tool_failure",
  "confirmation_required",
];

/**
 * 断言消息不包含任何内部名称。
 * 用于验证 ResponseBoundary 正确 sanitize 了输出。
 */
export function expectNoInternalNames(message: string): void {
  for (const name of INTERNAL_NAMES) {
    expect(
      message,
      `消息中不应包含内部名称 "${name}"，实际消息: "${message}"`
    ).not.toContain(name);
  }
  // 通用 action/tool 词（非中文上下文）
  expect(message).not.toMatch(/\baction\b/);
  expect(message).not.toMatch(/\btool\b/);
}

/**
 * 断言响应包含 confirmation_required（返回 confirmationId 且未直接写库）。
 */
export function expectConfirmationRequired(
  response: AgentResponse,
  taskCount: number,
  blockCount: number
): void {
  expect(
    response.confirmationId,
    "confirmation_required 响应必须有 confirmationId"
  ).toBeTruthy();
  expect(
    taskCount,
    "confirmation_required 阶段不应写入 task"
  ).toBe(0);
  expect(
    blockCount,
    "confirmation_required 阶段不应写入 block"
  ).toBe(0);
}

/**
 * 断言 refreshHints 包含预期字段。
 */
export function expectRefreshHints(
  hints: AgentRefreshHints | undefined,
  expected: Partial<AgentRefreshHints>
): void {
  expect(hints, "refreshHints 不应为空").toBeDefined();
  if (expected.tasks !== undefined) {
    expect(hints!.tasks).toBe(expected.tasks);
  }
  if (expected.timeline !== undefined) {
    expect(hints!.timeline).toBe(expected.timeline);
  }
  if (expected.timelineDate !== undefined) {
    expect(hints!.timelineDate).toBe(expected.timelineDate);
  }
}

/**
 * 断言响应消息包含至少一个指定词（中文友好）。
 */
export function expectMessageContainsOneOf(
  message: string,
  candidates: string[]
): void {
  const found = candidates.some((c) => message.includes(c));
  expect(
    found,
    `消息中应包含以下词之一：${candidates.join(" / ")}，实际消息: "${message}"`
  ).toBe(true);
}
