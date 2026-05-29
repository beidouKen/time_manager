import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "@/agent/AgentService";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";
import { ScheduleService } from "@/services/ScheduleService";
import type { Task, CreateTaskInput, TaskFilter } from "@/types/task.types";
import type {
  TimeBlock,
  CreateTimeBlockInput,
} from "@/types/timeblock.types";

const NOW = "2026-05-27T12:17:00.000Z";
const TIMEZONE = "Asia/Shanghai";

class MemoryTaskService extends TaskService {
  tasks: Task[] = [];
  private seq = 1;

  async getTasks(filter?: TaskFilter): Promise<Task[]> {
    let tasks = this.tasks;
    if (filter?.excludeDeleted) {
      tasks = tasks.filter((task) => !task.deleted_at);
    }
    if (filter?.status) {
      const statuses = Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
      tasks = tasks.filter((task) => statuses.includes(task.status));
    }
    return tasks;
  }

  async getTaskById(id: string): Promise<Task | null> {
    return this.tasks.find((task) => task.id === id) ?? null;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${this.seq++}`,
      title: input.title,
      description: input.description,
      deadline: input.deadline,
      estimated_duration_minutes: input.estimated_duration_minutes,
      priority: input.priority ?? "medium",
      status: "todo",
      category: input.category,
      is_flexible: input.is_flexible ?? true,
      can_split: input.can_split ?? false,
      created_at: now,
      updated_at: now,
    };
    this.tasks.unshift(task);
    return task;
  }

  markScheduled(taskId: string): void {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, status: "scheduled" } : task
    );
  }
}

class MemoryTimeBlockService extends TimeBlockService {
  blocks: TimeBlock[] = [];
  private seq = 1;

  async getBlocksByTaskId(taskId: string): Promise<TimeBlock[]> {
    return this.blocks.filter((block) => block.task_id === taskId);
  }

  async getBlocksForDate(date: Date): Promise<TimeBlock[]> {
    const key = date.toISOString().slice(0, 10);
    return this.blocks.filter((block) => block.start_time.slice(0, 10) === key);
  }

  async createTimeBlock(input: CreateTimeBlockInput): Promise<TimeBlock> {
    const now = new Date().toISOString();
    const block: TimeBlock = {
      id: `block-${this.seq++}`,
      task_id: input.task_id,
      title: input.title,
      start_time: input.start_time,
      end_time: input.end_time,
      type: input.type ?? "task",
      status: "scheduled",
      is_locked: input.is_locked ?? false,
      source: input.source ?? "system",
      created_at: now,
      updated_at: now,
    };
    this.blocks.push(block);
    return block;
  }
}

class MemoryScheduleService extends ScheduleService {
  constructor(
    private tasks: MemoryTaskService,
    private blocks: MemoryTimeBlockService
  ) {
    super();
  }

  async scheduleTaskToTimeBlock(input: {
    taskId: string;
    title: string;
    startTime: string;
    endTime: string;
  }): Promise<TimeBlock> {
    const task = await this.tasks.getTaskById(input.taskId);
    if (!task) throw new Error("任务不存在");
    const block = await this.blocks.createTimeBlock({
      task_id: input.taskId,
      title: input.title,
      start_time: input.startTime,
      end_time: input.endTime,
      type: "task",
      source: "system",
    });
    this.tasks.markScheduled(input.taskId);
    return block;
  }
}

function createAgentHarness(): {
  agent: AgentService;
  tasks: MemoryTaskService;
  blocks: MemoryTimeBlockService;
} {
  const tasks = new MemoryTaskService();
  const blocks = new MemoryTimeBlockService();
  const schedule = new MemoryScheduleService(tasks, blocks);
  const logService = {
    async logRequest(): Promise<{ id: string }> {
      return { id: crypto.randomUUID() };
    },
    async logToolExecution(): Promise<void> {},
    async logSuccess(): Promise<void> {},
    async logFailure(): Promise<void> {},
    async logCancelled(): Promise<void> {},
  };

  return {
    agent: new AgentService({
      taskService: tasks,
      timeBlockService: blocks,
      scheduleService: schedule,
      logService,
    }),
    tasks,
    blocks,
  };
}

function expectNoInternalNames(message: string): void {
  expect(message).not.toContain("用户打招呼");
  expect(message).not.toContain("闲聊响应");
  expect(message).not.toContain("用户询问助手身份");
  expect(message).not.toContain("ask_current_time");
  expect(message).not.toContain("userGoal");
  expect(message).not.toContain("SemanticFrameParser");
  expect(message).not.toContain("ActionPlanner");
  expect(message).not.toContain("tool_success");
  expect(message).not.toContain("create_reminder");
  expect(message).not.toContain("delete_task");
}

describe("V3.6.1 Agent Experience Pipeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers current time naturally without internal names", async () => {
    const { agent } = createAgentHarness();

    const response = await agent.processInput("现在是什么时候？", {
      timezone: TIMEZONE,
    });

    expect(response.message).toBe("现在是 2026年5月27日 20:17。");
    expectNoInternalNames(response.message);
    expect(response.metadata?.agentTrace?.rawInput).toBe("现在是什么时候？");
    expect(response.metadata?.agentTrace?.contextSnapshot).toBeDefined();
    expect(response.metadata?.agentTrace?.semanticFrame?.userGoal).toBe(
      "ask_current_time"
    );
    expect(response.metadata?.agentTrace?.actionPlan?.kind).toBe(
      "direct_response"
    );
    expect(response.metadata?.agentTrace?.toolResults).toEqual([]);
    expect(response.metadata?.agentTrace?.finalResponse).toBe(response.message);
  });

  it("answers loose current-time wording naturally", async () => {
    const { agent } = createAgentHarness();

    const response = await agent.processInput("现在几点啊", {
      timezone: TIMEZONE,
    });

    expect(response.message).toBe("现在是 2026年5月27日 20:17。");
    expectNoInternalNames(response.message);
  });

  it("responds to greeting through ResponseComposer", async () => {
    const { agent } = createAgentHarness();

    const response = await agent.processInput("你好", { timezone: TIMEZONE });

    expect(response.message).toBe(
      "你好！我可以帮你记录任务、安排时间、查询日程，也可以根据你的反馈调整计划。"
    );
    expectNoInternalNames(response.message);
  });

  it("answers assistant identity through ResponseComposer", async () => {
    const { agent } = createAgentHarness();

    const response = await agent.processInput("你是谁", { timezone: TIMEZONE });

    expect(response.message).toContain("我是你的时间管理助手");
    expect(response.message).toContain("创建任务");
    expectNoInternalNames(response.message);
  });

  it("uses natural unsupported fallback instead of frame summary", async () => {
    const { agent } = createAgentHarness();

    const response = await agent.processInput("帮我写一首诗", {
      timezone: TIMEZONE,
    });

    expect(response.message.length).toBeGreaterThan(0);
    expect(response.message).not.toContain("general chat");
    expect(response.message).not.toContain("unsupported_intent");
    expectNoInternalNames(response.message);
  });

  it("creates and schedules a temporary writing task from now", async () => {
    const { agent, tasks, blocks } = createAgentHarness();

    const response = await agent.processInput(
      "我现在有一个临时的写作任务，大概10分钟，从现在开始",
      { timezone: TIMEZONE }
    );

    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0].title).toBe("写作任务");
    expect(blocks.blocks).toHaveLength(1);
    expect(blocks.blocks[0].task_id).toBe(tasks.tasks[0].id);
    expect(
      Math.abs(
        new Date(blocks.blocks[0].start_time).getTime() -
          new Date(NOW).getTime()
      )
    ).toBeLessThanOrEqual(2 * 60 * 1000);
    expect(response.refreshHints).toMatchObject({
      tasks: true,
      timeline: true,
      timelineDate: "2026-05-27",
    });
    expect(response.message).toContain("我已把‘写作任务’安排到现在开始");
    expect(response.message).toContain("20:17 - 20:27");
    expectNoInternalNames(response.message);
  });

  it("answers where the just-created writing task is scheduled", async () => {
    const { agent } = createAgentHarness();

    await agent.processInput(
      "我现在有一个临时的写作任务，大概10分钟，从现在开始",
      { timezone: TIMEZONE }
    );
    const response = await agent.processInput("写作任务安排在哪？", {
      timezone: TIMEZONE,
    });

    expect(response.message).toBe("这个任务安排在 20:17 - 20:27。");
    expectNoInternalNames(response.message);
    expect(response.metadata?.agentTrace?.semanticFrame?.userGoal).toBe(
      "query_schedule"
    );
    expect(response.metadata?.agentTrace?.actionPlan?.kind).toBe(
      "query_schedule"
    );
    expect(response.metadata?.agentTrace?.actionPlan?.params.taskId).toBe(
      "task-1"
    );
  });

  it("creates a reminder event time_block from natural language", async () => {
    const { agent, blocks } = createAgentHarness();

    // NOW is 2026-05-27T12:17:00.000Z (UTC) = 20:17 CST
    // "今天下午三点" in Shanghai = 15:00 CST = 07:00 UTC
    const response = await agent.processInput("今天下午三点提醒我开会", {
      timezone: TIMEZONE,
    });

    expect(blocks.blocks.length).toBe(1);
    expect(blocks.blocks[0].type).toBe("event");
    expect(response.message).toContain("已为你设置提醒");
    expectNoInternalNames(response.message);
    expect(response.metadata?.agentTrace?.semanticFrame?.userGoal).toBe(
      "create_reminder"
    );
  });
});
