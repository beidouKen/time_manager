import { describe, expect, it } from "vitest";
import { ResponseBoundary } from "@/agent/experience/ResponseBoundary";
import type {
  AgentExperienceContext,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";

function makeContext(): AgentExperienceContext {
  return {
    currentDatetime: "2026-05-27T12:17:00.000Z",
    timezone: "Asia/Shanghai",
    recentMessages: [],
    lastCreatedTaskId: null,
    lastMentionedTaskIds: [],
    lastScheduledTimeBlockIds: [],
    lastToolResults: [],
  };
}

function makeFrame(overrides?: Partial<SemanticFrame>): SemanticFrame {
  return {
    userGoal: "general_chat",
    objectReferences: [],
    timeExpressions: [],
    durationExpressions: [],
    constraints: {},
    userTone: "neutral",
    urgency: "normal",
    missingInfo: [],
    confidence: 0.8,
    ...overrides,
  };
}

function makePlan(overrides?: Partial<ExperienceActionPlan>): ExperienceActionPlan {
  return {
    id: "test-id",
    kind: "direct_response",
    userGoal: "general_chat",
    params: {},
    requiresConfirmation: false,
    riskLevel: "safe",
    summary: "test",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ResponseBoundary.sanitize", () => {
  const boundary = new ResponseBoundary();

  it("strips internal names from explicit message", () => {
    const result = boundary.finalize({
      context: makeContext(),
      frame: makeFrame(),
      plan: makePlan(),
      result: {
        domain: "general_chat",
        message: "The userGoal is general_chat and ActionPlanner ran tool_success",
      },
    });
    expect(result).not.toContain("userGoal");
    expect(result).not.toContain("ActionPlanner");
    expect(result).not.toContain("tool_success");
  });

  it("unwraps bare JSON { message: '...' } response", () => {
    const result = boundary.finalize({
      context: makeContext(),
      frame: makeFrame(),
      plan: makePlan(),
      result: {
        domain: "general_chat",
        message: JSON.stringify({ message: "你好！我是你的助手。" }),
      },
    });
    expect(result).toBe("你好！我是你的助手。");
  });

  it("unwraps markdown-fenced JSON response", () => {
    const fenced = "```json\n{\"message\": \"这是提取的内容\"}\n```";
    const result = boundary.finalize({
      context: makeContext(),
      frame: makeFrame(),
      plan: makePlan(),
      result: {
        domain: "general_chat",
        message: fenced,
      },
    });
    expect(result).toBe("这是提取的内容");
  });

  it("collapses 3+ consecutive newlines to double newline", () => {
    const multiline = "第一行\n\n\n\n第二行";
    const result = boundary.finalize({
      context: makeContext(),
      frame: makeFrame(),
      plan: makePlan(),
      result: {
        domain: "general_chat",
        message: multiline,
      },
    });
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain("第一行");
    expect(result).toContain("第二行");
  });

  it("falls back to ResponseComposer when no explicit message", () => {
    const result = boundary.finalize({
      context: makeContext(),
      frame: makeFrame({ userGoal: "general_chat" }),
      plan: makePlan(),
      result: {
        domain: "general_chat",
        responseKind: "general",
      },
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain("userGoal");
  });
});
