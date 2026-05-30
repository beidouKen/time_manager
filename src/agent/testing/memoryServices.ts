// ============================================================
// memoryServices.ts — 公共进程内 Service/Repository 实现
//
// 抽取自 agent_router_gold.test.ts 和 v3_6_1_pipeline.test.ts。
// 仅供测试使用，不引入任何真实数据库或外部依赖。
//
// 使用方式：
//   import { MemoryTaskService, MemoryTimeBlockService, ... } from "@/agent/testing/memoryServices";
// ============================================================

import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";
import { ScheduleService } from "@/services/ScheduleService";
import type { IConfirmationRepository } from "@/repositories/interfaces/IConfirmationRepository";
import type { Task, CreateTaskInput, TaskFilter } from "@/types/task.types";
import type { TimeBlock, CreateTimeBlockInput } from "@/types/timeblock.types";
import type {
  PendingConfirmation,
  CreateConfirmationInput,
  ConfirmationStatus,
} from "@/types/agent.types";

// ─── MemoryTaskService ────────────────────────────────────────────────────────

export class MemoryTaskService extends TaskService {
  tasks: Task[] = [];
  private seq = 1;

  override async getTasks(filter?: TaskFilter): Promise<Task[]> {
    let tasks = this.tasks;
    if (filter?.excludeDeleted) {
      tasks = tasks.filter((t) => !t.deleted_at);
    }
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter((t) => statuses.includes(t.status));
    }
    return tasks;
  }

  override async getTaskById(id: string): Promise<Task | null> {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  override async createTask(input: CreateTaskInput): Promise<Task> {
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

  override async deleteTask(id: string): Promise<void> {
    const now = new Date().toISOString();
    this.tasks = this.tasks.map((t) =>
      t.id === id ? { ...t, deleted_at: now, updated_at: now } : t
    );
  }

  markScheduled(taskId: string): void {
    this.tasks = this.tasks.map((t) =>
      t.id === taskId ? { ...t, status: "scheduled" as const } : t
    );
  }
}

// ─── MemoryTimeBlockService ───────────────────────────────────────────────────

export class MemoryTimeBlockService extends TimeBlockService {
  blocks: TimeBlock[] = [];
  private seq = 1;

  override async getBlocksByTaskId(taskId: string): Promise<TimeBlock[]> {
    return this.blocks.filter((b) => b.task_id === taskId);
  }

  override async getBlocksForDate(date: Date): Promise<TimeBlock[]> {
    const key = date.toISOString().slice(0, 10);
    return this.blocks.filter((b) => b.start_time.slice(0, 10) === key);
  }

  /** V4: 多日查询支持 */
  async getBlocksForDateRange(from: Date, to: Date): Promise<TimeBlock[]> {
    const fromKey = from.toISOString().slice(0, 10);
    const toKey = to.toISOString().slice(0, 10);
    return this.blocks.filter((b) => {
      const dayKey = b.start_time.slice(0, 10);
      return dayKey >= fromKey && dayKey <= toKey && !b.deleted_at;
    });
  }

  override async getBlockById(id: string): Promise<TimeBlock | null> {
    return this.blocks.find((b) => b.id === id) ?? null;
  }

  override async createTimeBlock(input: CreateTimeBlockInput): Promise<TimeBlock> {
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

// ─── MemoryScheduleService ────────────────────────────────────────────────────

export class MemoryScheduleService extends ScheduleService {
  constructor(
    private tasksMem: MemoryTaskService,
    private blocksMem: MemoryTimeBlockService
  ) {
    super();
  }

  override async scheduleTaskToTimeBlock(input: {
    taskId: string;
    title: string;
    startTime: string;
    endTime: string;
  }): Promise<TimeBlock> {
    const task = await this.tasksMem.getTaskById(input.taskId);
    if (!task) throw new Error("任务不存在");
    const block = await this.blocksMem.createTimeBlock({
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

// ─── MemoryConfirmationRepository ────────────────────────────────────────────

export class MemoryConfirmationRepository implements IConfirmationRepository {
  records: PendingConfirmation[] = [];
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
    if (!record) throw new Error("confirmation not found");
    record.status = status;
    return record;
  }

  async expireOld(_beforeDate: string): Promise<number> {
    return 0;
  }
}

// ─── MemoryActionLogPort ──────────────────────────────────────────────────────

export interface ActionLogEntry {
  id: string;
  userInput: string;
  detectedIntent?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  status: "pending" | "success" | "failure" | "cancelled";
  result?: unknown;
  error?: string;
  createdAt: string;
}

export class MemoryActionLogPort {
  entries: ActionLogEntry[] = [];
  private seq = 1;

  async logRequest(
    userInput: string,
    detectedIntent?: string
  ): Promise<{ id: string }> {
    const entry: ActionLogEntry = {
      id: `log-${this.seq++}`,
      userInput,
      detectedIntent,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.entries.push(entry);
    return { id: entry.id };
  }

  async logToolExecution(
    logId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<void> {
    const entry = this.entries.find((e) => e.id === logId);
    if (entry) {
      entry.toolName = toolName;
      entry.toolArgs = toolArgs;
    }
  }

  async logSuccess(logId: string, result: unknown): Promise<void> {
    const entry = this.entries.find((e) => e.id === logId);
    if (entry) {
      entry.status = "success";
      entry.result = result;
    }
  }

  async logFailure(logId: string, errorMessage: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === logId);
    if (entry) {
      entry.status = "failure";
      entry.error = errorMessage;
    }
  }

  async logCancelled(logId: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === logId);
    if (entry) {
      entry.status = "cancelled";
    }
  }
}
