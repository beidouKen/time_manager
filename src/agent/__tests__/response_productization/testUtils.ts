import type {
  AgentExperienceContext,
  ExperienceActionPlan,
  SemanticFrame,
  SemanticUserGoal,
} from "@/agent/types";

export function makeContext(): AgentExperienceContext {
  return {
    currentDatetime: "2026-06-09T02:00:00.000Z",
    timezone: "Asia/Shanghai",
    recentMessages: [],
    lastCreatedTaskId: null,
    lastMentionedTaskIds: [],
    lastScheduledTimeBlockIds: [],
    lastToolResults: [],
  };
}

export function makeFrame(
  userGoal: SemanticUserGoal = "general_chat",
  overrides: Partial<SemanticFrame> = {}
): SemanticFrame {
  return {
    userGoal,
    objectReferences: [],
    timeExpressions: [],
    durationExpressions: [],
    constraints: {},
    missingInfo: [],
    confidence: 1,
    ...overrides,
  };
}

export function makePlan(
  overrides: Partial<ExperienceActionPlan> = {}
): ExperienceActionPlan {
  return {
    id: "plan-397",
    kind: "direct_response",
    userGoal: "general_chat",
    params: {},
    requiresConfirmation: false,
    riskLevel: "safe",
    summary: "test plan",
    createdAt: "2026-06-09T02:00:00.000Z",
    ...overrides,
  };
}
