// ============================================================
// ActionPlanner.batchDelete.test.ts
//
// 验证 #1 修复：buildBatchDeleteActions 在 dateRange 已提供但无匹配时
// 返回空 actions[]，不退回到"删除全部活跃任务"。
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { ActionPlanner } from "@/agent/experience/ActionPlanner";
import { TaskService } from "@/services/TaskService";
import type { Task, CreateTaskInput, TaskFilter } from "@/types/task.types";
import type { SemanticFrame } from "@/agent/types";

// ─── 最小化进程内 TaskService ─────────────────────────────────────────────────

class StubTaskService extends TaskService {
  tasks: Task[] = [];

  override async getTasks(filter?: TaskFilter): Promise<Task[]> {
    let result = this.tasks;
    if (filter?.excludeDeleted) result = result.filter((t) => !t.deleted_at);
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      result = result.filter((t) => statuses.includes(t.status));
    }
    return result;
  }

  override async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${this.tasks.length + 1}`,
      title: input.title,
      priority: input.priority ?? "medium",
      status: "todo",
      is_flexible: true,
      can_split: false,
      created_at: now,
      updated_at: now,
    };
    this.tasks.push(task);
    return task;
  }
}

// ─── 辅助：构造最小 SemanticFrame ────────────────────────────────────────────

function makeFrame(
  userGoal: SemanticFrame["userGoal"],
  dateRange?: SemanticFrame["dateRange"]
): SemanticFrame {
  return {
    userGoal,
    objectReferences: [],
    timeExpressions: [],
    durationExpressions: [],
    constraints: {},
    userTone: "neutral",
    urgency: "normal",
    missingInfo: [],
    confidence: 0.9,
    dateRange,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ActionPlanner.buildBatchDeleteActions — #1 误删修复", () => {
  let taskService: StubTaskService;
  let planner: ActionPlanner;

  beforeEach(() => {
    taskService = new StubTaskService();
    planner = new ActionPlanner(taskService);
  });

  it("dateRange 已提供但无匹配任务 → actions[] 为空，不删全部", async () => {
    // 准备：2 个活跃任务，但 deadline 在 dateRange 之外
    taskService.tasks = [
      {
        id: "t1",
        title: "任务A",
        status: "todo",
        priority: "medium",
        is_flexible: true,
        can_split: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        deadline: "2026-06-10T00:00:00.000Z", // 超出 dateRange
      },
      {
        id: "t2",
        title: "任务B",
        status: "scheduled",
        priority: "medium",
        is_flexible: true,
        can_split: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        deadline: "2026-06-11T00:00:00.000Z", // 超出 dateRange
      },
    ];

    const frame = makeFrame("batch_delete_tasks", {
      from: "2026-05-30",
      to: "2026-05-31",
      sourceText: "本周",
    });

    const context = {
      currentDatetime: new Date().toISOString(),
      timezone: "Asia/Shanghai",
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
      recentMessages: [],
    };

    const plan = await planner.plan(frame, context);

    expect(plan.kind).toBe("batch_action");
    const actions = plan.params.actions as unknown[];
    // 核心断言：空匹配 → 空 actions，不误删任何任务
    expect(actions).toHaveLength(0);
    expect(plan.summary).toContain("未找到活跃任务");
  });

  it("dateRange 未提供（删除全部）→ actions[] 包含所有活跃任务", async () => {
    taskService.tasks = [
      {
        id: "t1",
        title: "任务A",
        status: "todo",
        priority: "medium",
        is_flexible: true,
        can_split: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "t2",
        title: "任务B",
        status: "scheduled",
        priority: "medium",
        is_flexible: true,
        can_split: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    const frame = makeFrame("batch_delete_tasks", undefined);
    const context = {
      currentDatetime: new Date().toISOString(),
      timezone: "Asia/Shanghai",
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
      recentMessages: [],
    };

    const plan = await planner.plan(frame, context);

    expect(plan.kind).toBe("batch_action");
    const actions = plan.params.actions as unknown[];
    expect(actions).toHaveLength(2);
    expect(plan.summary).toContain("全部活跃任务");
  });

  it("dateRange 提供且有匹配任务 → 只删匹配的任务", async () => {
    taskService.tasks = [
      {
        id: "t1",
        title: "任务A（在范围内）",
        status: "todo",
        priority: "medium",
        is_flexible: true,
        can_split: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        deadline: "2026-05-31T00:00:00.000Z", // 在 dateRange 内
      },
      {
        id: "t2",
        title: "任务B（在范围外）",
        status: "scheduled",
        priority: "medium",
        is_flexible: true,
        can_split: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        deadline: "2026-06-10T00:00:00.000Z", // 在 dateRange 外
      },
    ];

    const frame = makeFrame("batch_delete_tasks", {
      from: "2026-05-30",
      to: "2026-05-31",
      sourceText: "本周",
    });
    const context = {
      currentDatetime: new Date().toISOString(),
      timezone: "Asia/Shanghai",
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
      recentMessages: [],
    };

    const plan = await planner.plan(frame, context);

    expect(plan.kind).toBe("batch_action");
    const actions = plan.params.actions as Array<{ params: { taskId: string } }>;
    expect(actions).toHaveLength(1);
    expect(actions[0].params.taskId).toBe("t1");
  });
});

describe("ActionPlanner.batch_reschedule_day — #6 可达性修复", () => {
  let taskService: StubTaskService;
  let planner: ActionPlanner;

  beforeEach(() => {
    taskService = new StubTaskService();
    planner = new ActionPlanner(taskService);
  });

  it("batch_reschedule_day → 生成含 reschedule_day 的 actions[]，不被 PlanSafetyValidator 拒绝", async () => {
    const frame = makeFrame("batch_reschedule_day", {
      from: "2026-05-30",
      to: "2026-05-30",
      sourceText: "今天",
    });
    const context = {
      currentDatetime: new Date().toISOString(),
      timezone: "Asia/Shanghai",
      lastCreatedTaskId: null,
      lastMentionedTaskIds: [],
      lastScheduledTimeBlockIds: [],
      lastToolResults: [],
      recentMessages: [],
    };

    const plan = await planner.plan(frame, context);

    expect(plan.kind).toBe("batch_action");
    const actions = plan.params.actions as Array<{ toolName: string; params: { date: string } }>;
    expect(Array.isArray(actions)).toBe(true);
    expect(actions).toHaveLength(1);
    expect(actions[0].toolName).toBe("reschedule_day");
    expect(actions[0].params.date).toBe("2026-05-30");
  });
});
