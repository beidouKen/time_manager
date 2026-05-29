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

class MemoryTaskService extends TaskService {
  tasks: Task[] = [];
  private seq = 1;

  async getTasks(filter?: TaskFilter): Promise<Task[]> {
    let tasks = this.tasks;
    if (filter?.excludeDeleted) {
      tasks = tasks.filter((task) => !task.deleted_at);
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

describe("Agent router gold set", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes time management exact schedule", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    expect(tasks.tasks.length).toBe(1);
    expect(blocks.blocks.length).toBe(1);
  });

  it("routes recommendation request without write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("帮我安排一个写文档任务，30分钟");
    expect(response.message).toContain("我建议安排在");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
  });

  it("routes external info to no-tool response", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("今天上海天气怎么样");
    expect(response.message).toContain("无法直接联网查询");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
  });

  it("routes feedback to feedback response", async () => {
    const { agent } = createAgentHarness();
    const response = await agent.processInput("你这个回答不对");
    expect(response.message).toContain("收到你的反馈");
  });

  it("routes low signal input", async () => {
    const { agent } = createAgentHarness();
    const response = await agent.processInput("?");
    expect(response.message).toContain("不太确定你的目标");
  });

  it("routes assistant meta input", async () => {
    const { agent } = createAgentHarness();
    const response = await agent.processInput("你是谁");
    expect(response.message).toContain("时间管理助手");
  });

  it("general/writing/knowledge do not create data", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    await agent.processInput("你好呀");
    await agent.processInput("什么是番茄工作法");
    await agent.processInput("帮我写一段开场白");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
  });
});
