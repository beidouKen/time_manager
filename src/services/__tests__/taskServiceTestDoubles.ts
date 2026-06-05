import type { ITaskRepository } from "@/repositories/interfaces/ITaskRepository";
import type { ITimeBlockRepository } from "@/repositories/interfaces/ITimeBlockRepository";
import type {
  CreateTaskInput,
  Task,
  TaskFilter,
  UpdateTaskInput,
} from "@/types/task.types";
import type {
  CreateTimeBlockInput,
  TimeBlock,
  UpdateTimeBlockInput,
} from "@/types/timeblock.types";

function nullable<T>(value: T | null | undefined, fallback: T | undefined): T | undefined {
  return value === null ? undefined : value ?? fallback;
}

export class MemoryTaskRepo implements ITaskRepository {
  tasks: Task[] = [];
  private seq = 1;

  async findAll(filter?: TaskFilter): Promise<Task[]> {
    let tasks = [...this.tasks];
    if (filter?.excludeDeleted) tasks = tasks.filter((task) => !task.deleted_at);
    if (!filter?.includeArchived) tasks = tasks.filter((task) => !task.archived_at);
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter((task) => statuses.includes(task.status));
    }
    return tasks;
  }

  async findById(id: string, options?: { excludeDeleted?: boolean }): Promise<Task | null> {
    const task = this.tasks.find((item) => item.id === id) ?? null;
    if (task && options?.excludeDeleted && task.deleted_at) return null;
    return task;
  }

  async create(data: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${this.seq++}`,
      title: data.title,
      description: data.description,
      deadline: data.deadline,
      estimated_duration_minutes: data.estimated_duration_minutes,
      priority: data.priority ?? "medium",
      status: "todo",
      category: data.category,
      is_flexible: data.is_flexible ?? true,
      can_split: data.can_split ?? false,
      created_at: now,
      updated_at: now,
    };
    this.tasks.push(task);
    return task;
  }

  async update(id: string, data: UpdateTaskInput): Promise<Task> {
    const idx = this.tasks.findIndex((task) => task.id === id);
    if (idx < 0) throw new Error(`task not found: ${id}`);
    const existing = this.tasks[idx];
    const updated: Task = {
      ...existing,
      ...data,
      deadline: nullable(data.deadline, existing.deadline),
      estimated_duration_minutes: nullable(
        data.estimated_duration_minutes,
        existing.estimated_duration_minutes
      ),
      category: nullable(data.category, existing.category),
      archived_at: nullable(data.archived_at, existing.archived_at),
      completed_at: nullable(data.completed_at, existing.completed_at),
      deferred_until: nullable(data.deferred_until, existing.deferred_until),
      updated_at: new Date().toISOString(),
    };
    this.tasks[idx] = updated;
    return updated;
  }

  async softDelete(id: string): Promise<void> {
    const idx = this.tasks.findIndex((task) => task.id === id);
    if (idx < 0) throw new Error(`task not found: ${id}`);
    this.tasks[idx] = {
      ...this.tasks[idx],
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}

export class MemoryBlockRepo implements ITimeBlockRepository {
  blocks: TimeBlock[] = [];
  private seq = 1;

  async findByDateRange(start: Date, end: Date): Promise<TimeBlock[]> {
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    return this.blocks.filter(
      (block) =>
        !block.deleted_at &&
        block.start_time >= startIso &&
        block.start_time < endIso
    );
  }

  async findByTaskId(taskId: string): Promise<TimeBlock[]> {
    return this.blocks.filter((block) => block.task_id === taskId);
  }

  async findById(
    id: string,
    options?: { excludeDeleted?: boolean }
  ): Promise<TimeBlock | null> {
    const block = this.blocks.find((item) => item.id === id) ?? null;
    if (block && options?.excludeDeleted && block.deleted_at) return null;
    return block;
  }

  async create(data: CreateTimeBlockInput): Promise<TimeBlock> {
    const now = new Date().toISOString();
    const block: TimeBlock = {
      id: `block-${this.seq++}`,
      task_id: data.task_id,
      title: data.title,
      start_time: data.start_time,
      end_time: data.end_time,
      type: data.type ?? "task",
      status: "scheduled",
      is_locked: data.is_locked ?? false,
      source: data.source ?? "manual",
      created_at: now,
      updated_at: now,
    };
    this.blocks.push(block);
    return block;
  }

  async update(id: string, data: UpdateTimeBlockInput): Promise<TimeBlock> {
    const idx = this.blocks.findIndex((block) => block.id === id);
    if (idx < 0) throw new Error(`block not found: ${id}`);
    const existing = this.blocks[idx];
    const updated: TimeBlock = {
      ...existing,
      ...data,
      task_id: nullable(data.task_id, existing.task_id),
      deleted_at: nullable(data.deleted_at, existing.deleted_at),
      reminder_sent_at: nullable(data.reminder_sent_at, existing.reminder_sent_at),
      start_prompt_sent_at: nullable(
        data.start_prompt_sent_at,
        existing.start_prompt_sent_at
      ),
      end_prompt_sent_at: nullable(data.end_prompt_sent_at, existing.end_prompt_sent_at),
      started_at: nullable(data.started_at, existing.started_at),
      completed_at: nullable(data.completed_at, existing.completed_at),
      skipped_at: nullable(data.skipped_at, existing.skipped_at),
      delayed_at: nullable(data.delayed_at, existing.delayed_at),
      feedback_note: nullable(data.feedback_note, existing.feedback_note),
      feedback_snoozed_until: nullable(
        data.feedback_snoozed_until,
        existing.feedback_snoozed_until
      ),
      updated_at: new Date().toISOString(),
    };
    this.blocks[idx] = updated;
    return updated;
  }

  async softDelete(id: string): Promise<void> {
    const idx = this.blocks.findIndex((block) => block.id === id);
    if (idx < 0) throw new Error(`block not found: ${id}`);
    this.blocks[idx] = {
      ...this.blocks[idx],
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  async countActiveByTaskId(taskId: string): Promise<number> {
    return this.blocks.filter(
      (block) =>
        block.task_id === taskId &&
        !block.deleted_at &&
        (block.status === "scheduled" || block.status === "in_progress")
    ).length;
  }
}
