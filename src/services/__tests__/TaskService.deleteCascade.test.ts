// ============================================================
// TaskService.deleteCascade.test.ts
//
// 验证 #8 修复：TaskService.deleteTask 在 task 软删失败时，
// 已软删的关联 blocks 应被回滚（deleted_at 清为 null），
// 且 task 保持未删除状态。
// ============================================================

import { describe, it, expect } from "vitest";
import { TaskService } from "@/services/TaskService";
import type { ITaskRepository } from "@/repositories/interfaces/ITaskRepository";
import type { ITimeBlockRepository } from "@/repositories/interfaces/ITimeBlockRepository";
import type { Task, CreateTaskInput, UpdateTaskInput, TaskFilter, TaskStatus } from "@/types/task.types";
import type {
  TimeBlock,
  CreateTimeBlockInput,
  UpdateTimeBlockInput,
} from "@/types/timeblock.types";

// ─── 最小进程内 TaskRepository ────────────────────────────────────────────────

class MemoryTaskRepo implements ITaskRepository {
  tasks: Task[] = [];
  private seq = 1;
  softDeleteShouldFail = false;

  async findAll(filter?: TaskFilter): Promise<Task[]> {
    let tasks = this.tasks;
    if (filter?.excludeDeleted) tasks = tasks.filter((t) => !t.deleted_at);
    return tasks;
  }

  async findById(id: string): Promise<Task | null> {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  async create(data: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${this.seq++}`,
      title: data.title,
      priority: data.priority ?? "medium",
      status: "todo",
      is_flexible: data.is_flexible ?? true,
      can_split: data.can_split ?? false,
      created_at: now,
      updated_at: now,
    };
    this.tasks.push(task);
    return task;
  }

  async update(id: string, data: UpdateTaskInput): Promise<Task> {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error("not found");
    this.tasks[idx] = { ...this.tasks[idx], ...data, updated_at: new Date().toISOString() };
    return this.tasks[idx];
  }

  async updateStatus(_id: string, _status: TaskStatus): Promise<void> {}

  async softDelete(id: string): Promise<void> {
    if (this.softDeleteShouldFail) {
      throw new Error("模拟 task 软删失败");
    }
    const t = this.tasks.find((x) => x.id === id);
    if (t) t.deleted_at = new Date().toISOString();
  }
}

// ─── 最小进程内 TimeBlockRepository ──────────────────────────────────────────

class MemoryBlockRepo implements ITimeBlockRepository {
  blocks: TimeBlock[] = [];
  private seq = 1;

  async findByDateRange(_s: Date, _e: Date): Promise<TimeBlock[]> {
    return [];
  }

  async findByTaskId(taskId: string): Promise<TimeBlock[]> {
    return this.blocks.filter((b) => b.task_id === taskId);
  }

  async findById(id: string): Promise<TimeBlock | null> {
    return this.blocks.find((b) => b.id === id) ?? null;
  }

  async create(data: CreateTimeBlockInput): Promise<TimeBlock> {
    const now = new Date().toISOString();
    const b: TimeBlock = {
      id: `b-${this.seq++}`,
      task_id: data.task_id,
      title: data.title,
      start_time: data.start_time,
      end_time: data.end_time,
      type: data.type ?? "task",
      status: "scheduled",
      is_locked: false,
      source: "manual",
      created_at: now,
      updated_at: now,
    };
    this.blocks.push(b);
    return b;
  }

  async update(id: string, data: UpdateTimeBlockInput): Promise<TimeBlock> {
    const idx = this.blocks.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error("not found");
    const existing = this.blocks[idx];
    const next: TimeBlock = {
      ...existing,
      ...data,
      task_id: data.task_id === null ? undefined : (data.task_id ?? existing.task_id),
      // deleted_at: null 表示清除软删除标记（回滚用）
      deleted_at: data.deleted_at === null ? undefined : (data.deleted_at ?? existing.deleted_at),
      updated_at: new Date().toISOString(),
    };
    this.blocks[idx] = next;
    return next;
  }

  async softDelete(id: string): Promise<void> {
    const b = this.blocks.find((x) => x.id === id);
    if (b) b.deleted_at = new Date().toISOString();
  }

  async countActiveByTaskId(taskId: string): Promise<number> {
    return this.blocks.filter(
      (b) =>
        b.task_id === taskId &&
        !b.deleted_at &&
        !["done", "skipped", "cancelled", "delayed"].includes(b.status)
    ).length;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("TaskService.deleteTask 补偿回滚 — #8 修复", () => {
  it("task 软删成功 → task 和 blocks 均被软删", async () => {
    const taskRepo = new MemoryTaskRepo();
    const blockRepo = new MemoryBlockRepo();
    const service = new TaskService(taskRepo, blockRepo);

    const task = await taskRepo.create({ title: "测试任务" });
    blockRepo.blocks = [
      {
        id: "b1",
        task_id: task.id,
        title: "时间块1",
        start_time: "2026-05-30T10:00:00.000Z",
        end_time: "2026-05-30T10:30:00.000Z",
        type: "task",
        status: "scheduled",
        is_locked: false,
        source: "manual",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    await service.deleteTask(task.id);

    const deletedTask = await taskRepo.findById(task.id);
    expect(deletedTask?.deleted_at).toBeDefined();

    const blocks = await blockRepo.findByTaskId(task.id);
    expect(blocks[0].deleted_at).toBeDefined();
  });

  it("task 软删失败 → 已软删的 blocks 被回滚（deleted_at 清空），task 保持未删除", async () => {
    const taskRepo = new MemoryTaskRepo();
    const blockRepo = new MemoryBlockRepo();
    const service = new TaskService(taskRepo, blockRepo);

    const task = await taskRepo.create({ title: "测试任务" });
    blockRepo.blocks = [
      {
        id: "b1",
        task_id: task.id,
        title: "时间块1",
        start_time: "2026-05-30T10:00:00.000Z",
        end_time: "2026-05-30T10:30:00.000Z",
        type: "task",
        status: "scheduled",
        is_locked: false,
        source: "manual",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    // 让 task 软删失败
    taskRepo.softDeleteShouldFail = true;

    await expect(service.deleteTask(task.id)).rejects.toThrow("模拟 task 软删失败");

    // 核心断言 1：task 应未被删除
    const taskStillAlive = await taskRepo.findById(task.id);
    expect(taskStillAlive?.deleted_at).toBeUndefined();

    // 核心断言 2：已被软删的 block 应被回滚（deleted_at 被清除）
    const block = blockRepo.blocks.find((b) => b.id === "b1");
    expect(block?.deleted_at).toBeUndefined();
  });
});
