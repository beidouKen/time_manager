import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "@/agent/AgentService";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";
import { ScheduleService } from "@/services/ScheduleService";
import { ConfirmationService } from "@/services/ConfirmationService";
import type { IConfirmationRepository } from "@/repositories/interfaces/IConfirmationRepository";
import type { Task, CreateTaskInput, TaskFilter } from "@/types/task.types";
import type {
  TimeBlock,
  CreateTimeBlockInput,
} from "@/types/timeblock.types";
import type {
  PendingConfirmation,
  CreateConfirmationInput,
  ConfirmationStatus,
} from "@/types/agent.types";

const NOW = "2026-05-27T12:17:00.000Z";

// ─── in-memory ConfirmationRepository ────────────────────────────────────────

class MemoryConfirmationRepository implements IConfirmationRepository {
  private records: PendingConfirmation[] = [];
  private seq = 1;

  async create(data: CreateConfirmationInput): Promise<PendingConfirmation> {
    const record: PendingConfirmation = {
      id: `conf-${this.seq++}`,
      action_type: data.action_type,
      tool_name: data.tool_name,
      tool_args_json: data.tool_args_json,
      description: data.description,
      risk_level: data.risk_level ?? "medium",
      status: "pending",
      created_at: new Date().toISOString(),
      expires_at: data.expires_at,
    };
    this.records.push(record);
    return record;
  }

  async findById(id: string): Promise<PendingConfirmation | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }

  async findPending(): Promise<PendingConfirmation[]> {
    return this.records.filter((r) => r.status === "pending");
  }

  async updateStatus(id: string, status: ConfirmationStatus): Promise<PendingConfirmation> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error("not found");
    record.status = status;
    return record;
  }

  async expireOld(_beforeDate: string): Promise<number> {
    return 0;
  }
}

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

  async deleteTask(id: string): Promise<void> {
    const now = new Date().toISOString();
    this.tasks = this.tasks.map((t) =>
      t.id === id ? { ...t, deleted_at: now, updated_at: now } : t
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
    return block;
  }
}

function createAgentHarness(): {
  agent: AgentService;
  tasks: MemoryTaskService;
  blocks: MemoryTimeBlockService;
  confirmRepo: MemoryConfirmationRepository;
} {
  const tasks = new MemoryTaskService();
  const blocks = new MemoryTimeBlockService();
  const schedule = new MemoryScheduleService(tasks, blocks);
  const confirmRepo = new MemoryConfirmationRepository();
  const confirmService = new ConfirmationService(confirmRepo);
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
      confirmService,
      llmClient: null, // V3.7: 测试中禁用 LLM，走规则路径
    }),
    tasks,
    blocks,
    confirmRepo,
  };
}

function expectNoInternalNames(message: string): void {
  expect(message).not.toContain("userGoal");
  expect(message).not.toContain("toolName");
  expect(message).not.toContain("ActionPlanner");
  expect(message).not.toContain("ToolRouter");
  expect(message).not.toContain("LLMPlanner");
  expect(message).not.toContain("processWith");
  expect(message).not.toMatch(/\baction\b/);
  expect(message).not.toMatch(/\btool\b/);
}

describe("Agent router gold set", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── time_management ──────────────────────────────────────────────────────

  it("time_management: exact schedule writes 1 task + 1 block", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    expect(tasks.tasks.length).toBe(1);
    expect(blocks.blocks.length).toBe(1);
  });

  it("time_management: recommendation request does not write data", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("帮我安排一个写文档任务，30分钟");
    expect(response.message).toContain("我建议安排在");
    expect(response.confirmationId).toBeTruthy();
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
  });

  it("time_management: confirming recommendation writes task + block", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("帮我安排一个写文档任务，30分钟", {
      timezone: "Asia/Shanghai",
    });
    expect(response.confirmationId).toBeTruthy();
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);

    const confirmResult = await agent.confirmAction(response.confirmationId!);
    expect(tasks.tasks.length).toBe(1);
    expect(blocks.blocks.length).toBe(1);
    expect(confirmResult.refreshHints).toMatchObject({
      tasks: true,
      timeline: true,
    });
  });

  it("time_management: query schedule after create returns time range", async () => {
    const { agent } = createAgentHarness();
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    const response = await agent.processInput("写文档任务安排在哪");
    expect(response.message).toContain("安排在");
    expectNoInternalNames(response.message);
  });

  it("time_management: current time query returns formatted time", async () => {
    const { agent } = createAgentHarness();
    const response = await agent.processInput("现在几点啊");
    expect(response.message).toContain("2026");
    expectNoInternalNames(response.message);
  });

  // ─── external_info ────────────────────────────────────────────────────────

  it("external_info: weather query returns no-tool notice, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("今天上海天气怎么样");
    expect(response.message).toContain("无法直接联网查询");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  it("external_info: news query returns no-tool notice, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("今天有什么新闻");
    expect(response.message).toContain("无法直接联网查询");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  // ─── assistant_meta ────────────────────────────────────────────────────────

  it("assistant_meta: who are you returns identity, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("你是谁");
    expect(response.message).toContain("时间管理助手");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  it("assistant_meta: what can you do returns capabilities, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("你能做什么");
    // V3.7 P1: MetaHandler 子分类，"你能做什么" → meta_capabilities，列出功能
    expect(response.message.length).toBeGreaterThan(0);
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  // ─── feedback_or_complaint ─────────────────────────────────────────────────

  it("feedback_or_complaint: wrong answer feedback returns ack, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("你这个回答不对");
    expect(response.message).toContain("收到你的反馈");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  it("feedback_or_complaint: useless complaint returns ack, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("太慢了没用");
    expect(response.message).toContain("收到你的反馈");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  // ─── writing_assistant ─────────────────────────────────────────────────────

  it("writing_assistant: poem request returns non-empty text, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("帮我写一首诗");
    expect(response.message.length).toBeGreaterThan(0);
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  it("writing_assistant: polish request returns non-empty text, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("帮我润色这段话");
    expect(response.message.length).toBeGreaterThan(0);
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  // ─── knowledge_qa ──────────────────────────────────────────────────────────

  it("knowledge_qa: what is pomodoro returns non-empty text, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("什么是番茄工作法");
    expect(response.message.length).toBeGreaterThan(0);
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  it("knowledge_qa: why manage time returns non-empty text, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("为什么要做时间管理");
    expect(response.message.length).toBeGreaterThan(0);
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  // ─── low_signal ────────────────────────────────────────────────────────────

  it("low_signal: single punctuation returns guidance, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("?");
    expect(response.message).toContain("不太确定你的目标");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  it("low_signal: multiple punctuation returns guidance, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("？？");
    expect(response.message).toContain("不太确定你的目标");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  // ─── general_chat ──────────────────────────────────────────────────────────

  it("general_chat: greeting returns welcome message, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("你好呀");
    expect(response.message.length).toBeGreaterThan(0);
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  it("general_chat: casual remark returns non-empty text, no write", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("今天心情不错");
    expect(response.message.length).toBeGreaterThan(0);
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expectNoInternalNames(response.message);
  });

  // ─── time_management: natural time + reminder + delete ────────────────────

  it("time_management: natural time input routes to time_management (recommendation path)", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("明天下午三点做项目复盘，大概30分钟");
    // No start_now → recommendation path (no writes)
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expect(response.message.length).toBeGreaterThan(0);
    expectNoInternalNames(response.message);
  });

  it("time_management: future exact time creates task + time_block", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("创建项目复盘任务，明天下午三点，30分钟", {
      timezone: "Asia/Shanghai",
    });
    expect(tasks.tasks.length).toBe(1);
    expect(blocks.blocks.length).toBe(1);
    expect(response.message).toContain("明天下午三点");
    expect(response.refreshHints).toMatchObject({
      tasks: true,
      timeline: true,
    });
    expectNoInternalNames(response.message);
  });

  it("time_management: reminder input creates event time_block", async () => {
    const { agent, blocks } = createAgentHarness();
    // Use explicit time "下午三点" relative to fake NOW (2026-05-27 12:17 UTC)
    const response = await agent.processInput("明天下午三点提醒我开会", {
      timezone: "Asia/Shanghai",
    });
    expect(blocks.blocks.length).toBe(1);
    expect(blocks.blocks[0].type).toBe("event");
    expect(response.message).toContain("已为你设置提醒");
    expectNoInternalNames(response.message);
  });

  it("time_management: delete task issues confirmation (does not delete immediately)", async () => {
    const { agent, tasks } = createAgentHarness();
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    expect(tasks.tasks.length).toBe(1);
    const response = await agent.processInput("删除写文档任务");
    expect(response.confirmationId).toBeTruthy();
    // Task must NOT be deleted yet
    const aliveTask = tasks.tasks.find((t) => !t.deleted_at);
    expect(aliveTask).toBeDefined();
    expectNoInternalNames(response.message);
  });

  it("time_management: confirmAction actually deletes the task", async () => {
    const { agent, tasks } = createAgentHarness();
    await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
    const deleteResponse = await agent.processInput("删除写文档任务");
    const confirmationId = deleteResponse.confirmationId;
    expect(confirmationId).toBeTruthy();

    const confirmResult = await agent.confirmAction(confirmationId!);
    expect(confirmResult.message.length).toBeGreaterThan(0);
    // Task should now be soft-deleted
    const task = tasks.tasks[0];
    expect(task?.deleted_at).toBeTruthy();
  });

  it("time_management: recommendation uses timezone and never returns past time (V3.7 P0-3)", async () => {
    const { agent } = createAgentHarness();
    const response = await agent.processInput("帮我安排一个写文档任务，30分钟", {
      timezone: "Asia/Shanghai",
    });
    expect(response.message).toContain("我建议安排在");

    // V3.7 P0-3: 推荐时间必须 >= now + buffer(15min)，不能再返回 08:00 这种已过去的时间。
    // 当前 fake clock NOW="2026-05-27T12:17:00.000Z"（上海 20:17）。
    // 期望推荐 >= 上海 20:32。
    const timeMatch = response.message.match(/我建议安排在\s*(\d{2}:\d{2})/);
    expect(timeMatch).not.toBeNull();
    const [hh, mm] = timeMatch![1].split(":").map(Number);
    const proposedMinutes = hh * 60 + mm;

    // NOW UTC = 12:17 → 上海 20:17
    // earliestAllowed (上海) = 20:32
    const nowShanghaiMinutes = 20 * 60 + 17;
    const bufferMinutes = 15;
    expect(proposedMinutes).toBeGreaterThanOrEqual(
      nowShanghaiMinutes + bufferMinutes
    );

    // 同时确保 ≥ 08:00 的旧约束依然成立（局部健壮性）
    expect(hh).toBeGreaterThanOrEqual(8);
    expectNoInternalNames(response.message);
  });

  // ─── cross-domain: combined no-write assertion ─────────────────────────────

  it("general/writing/knowledge do not create data across three requests", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    await agent.processInput("你好呀");
    await agent.processInput("什么是番茄工作法");
    await agent.processInput("帮我写一段开场白");
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
  });

  // ─── V3.7 P1: Pending Confirmation 快捷路径 ─────────────────────────────────

  it("pending confirm + '好' → 直接触发 confirmAction，写入任务和时间块", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    // Step 1: 发出推荐请求，获取 confirmationId
    const response = await agent.processInput("帮我安排一个写文档任务，30分钟", {
      timezone: "Asia/Shanghai",
    });
    expect(response.confirmationId).toBeTruthy();
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);

    // Step 2: 用"好"回复，传入 pendingConfirmationId → ContextualPreRouter 捕获
    const confirmResponse = await agent.processInput("好", {
      timezone: "Asia/Shanghai",
      pendingConfirmationId: response.confirmationId!,
    });
    // 确认执行后应有 task + block
    expect(tasks.tasks.length).toBe(1);
    expect(blocks.blocks.length).toBe(1);
    expect(confirmResponse.message.length).toBeGreaterThan(0);
    expectNoInternalNames(confirmResponse.message);
  });

  it("pending confirm + 'ok' → 直接触发 confirmAction", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("帮我安排一个写报告任务，30分钟", {
      timezone: "Asia/Shanghai",
    });
    expect(response.confirmationId).toBeTruthy();

    await agent.processInput("ok", {
      timezone: "Asia/Shanghai",
      pendingConfirmationId: response.confirmationId!,
    });
    expect(tasks.tasks.length).toBe(1);
    expect(blocks.blocks.length).toBe(1);
  });

  it("pending confirm + '确认' → 直接触发 confirmAction", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("帮我安排一个读书任务，20分钟", {
      timezone: "Asia/Shanghai",
    });
    expect(response.confirmationId).toBeTruthy();

    await agent.processInput("确认", {
      timezone: "Asia/Shanghai",
      pendingConfirmationId: response.confirmationId!,
    });
    expect(tasks.tasks.length).toBe(1);
    expect(blocks.blocks.length).toBe(1);
  });

  it("pending confirm + '取消' → 触发 rejectAction，不写入数据", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("帮我安排一个写文档任务，30分钟", {
      timezone: "Asia/Shanghai",
    });
    expect(response.confirmationId).toBeTruthy();

    const rejectResponse = await agent.processInput("取消", {
      timezone: "Asia/Shanghai",
      pendingConfirmationId: response.confirmationId!,
    });
    // 取消后不应有任务和时间块
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    expect(rejectResponse.message.length).toBeGreaterThan(0);
  });

  it("pending confirm + '不' → 触发 rejectAction", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("帮我安排一个任务，30分钟", {
      timezone: "Asia/Shanghai",
    });
    expect(response.confirmationId).toBeTruthy();

    await agent.processInput("不", {
      timezone: "Asia/Shanghai",
      pendingConfirmationId: response.confirmationId!,
    });
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
  });

  it("无 pending 状态时 '好' → low_signal（不触发确认）", async () => {
    const { agent, tasks, blocks } = createAgentHarness();
    const response = await agent.processInput("好");
    // 单字符 → low_signal → 不触发确认，也不创建任何数据
    expect(tasks.tasks.length).toBe(0);
    expect(blocks.blocks.length).toBe(0);
    // low_signal 消息应包含引导文案
    expect(response.message).toContain("不太确定你的目标");
    expectNoInternalNames(response.message);
  });

  // ─── V3.7 P1: proposeEndFeedback split → 3 options ─────────────────────────

  it("proposeEndFeedback split → 返回 3 个方案，包含正确 uiAction", async () => {
    const { agent } = createAgentHarness();
    // 先创建时间块
    await agent.processInput("我现在有一个写文档任务，30分钟，从现在开始");

    const mockBlock = {
      id: "block-1",
      task_id: "task-1",
      title: "写文档",
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 30 * 60000).toISOString(),
      type: "task" as const,
      status: "scheduled" as const,
      is_locked: false,
      source: "system" as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const proposal = await agent.proposeEndFeedback(mockBlock, "split");
    expect(proposal.options.length).toBe(3);

    // 第 1 个：仅创建，无 uiAction
    expect(proposal.options[0].id).toBe("split_create_only");
    expect(proposal.options[0].uiAction).toBeUndefined();
    expect(proposal.options[0].toolName).toBe("create_task");

    // 第 2 个：创建 + 推荐时间
    expect(proposal.options[1].id).toBe("split_create_recommend");
    expect(proposal.options[1].uiAction?.kind).toBe("split_then_recommend");
    expect((proposal.options[1].uiAction as { kind: "split_then_recommend"; durationMinutes: number }).durationMinutes).toBeGreaterThan(0);

    // 第 3 个：创建 + 手动选时间
    expect(proposal.options[2].id).toBe("split_create_manual");
    expect(proposal.options[2].uiAction?.kind).toBe("open_schedule_dialog");
  });
});
