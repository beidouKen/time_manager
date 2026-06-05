import { SqliteTaskRepository } from "@/repositories/sqlite/SqliteTaskRepository";
import { SqliteTimeBlockRepository } from "@/repositories/sqlite/SqliteTimeBlockRepository";
import type { ITaskRepository } from "@/repositories/interfaces/ITaskRepository";
import type { ITimeBlockRepository } from "@/repositories/interfaces/ITimeBlockRepository";
import { TimeBlockService } from "@/services/TimeBlockService";
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskStatus,
} from "@/types/task.types";
import { CreateTaskSchema, UpdateTaskSchema } from "@/types/task.types";

export class TaskService {
  private repo: ITaskRepository;
  private blockRepo: ITimeBlockRepository;
  private timeBlockService: TimeBlockService;

  constructor(repo?: ITaskRepository, blockRepo?: ITimeBlockRepository) {
    this.repo = repo ?? new SqliteTaskRepository();
    this.blockRepo = blockRepo ?? new SqliteTimeBlockRepository();
    this.timeBlockService = new TimeBlockService(this.blockRepo);
  }

  async getTasks(filter?: TaskFilter): Promise<Task[]> {
    return this.repo.findAll(filter);
  }

  async getTaskById(id: string): Promise<Task | null> {
    return this.repo.findById(id, { excludeDeleted: true });
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const validated = CreateTaskSchema.parse(input);
    return this.repo.create(validated);
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
    const existing = await this.repo.findById(id, { excludeDeleted: true });
    if (!existing) throw new Error("任务不存在");

    const validated = UpdateTaskSchema.parse(input);
    return this.repo.update(id, validated);
  }

  async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    const existing = await this.repo.findById(id, { excludeDeleted: true });
    if (!existing) throw new Error("任务不存在");
    const now = new Date().toISOString();
    return this.repo.update(id, {
      status,
      ...(status === "done" ? { completed_at: existing.completed_at ?? now } : {}),
      ...(status !== "done" && status !== "archived" ? { completed_at: null } : {}),
      ...(status !== "archived" ? { archived_at: null } : {}),
      ...(status !== "deferred" ? { deferred_until: null } : {}),
    });
  }

  async deleteTask(id: string): Promise<void> {
    const existing = await this.repo.findById(id, { excludeDeleted: true });
    if (!existing) throw new Error("任务不存在");

    // 先软删关联的活跃时间块，记录已处理的 id 以便回滚
    const blocks = await this.blockRepo.findByTaskId(id);
    const activeBlocks = blocks.filter((b) => !b.deleted_at);
    const deletedBlockIds: string[] = [];

    for (const block of activeBlocks) {
      await this.blockRepo.softDelete(block.id);
      deletedBlockIds.push(block.id);
    }

    // 再软删任务本体；若失败则回滚已删的时间块
    try {
      await this.repo.softDelete(id);
    } catch (taskDeleteErr) {
      // 补偿：将已软删的时间块 deleted_at 清回 null
      for (const blockId of deletedBlockIds) {
        try {
          await this.blockRepo.update(blockId, { deleted_at: null });
        } catch {
          // 回滚失败只记录，不覆盖原始错误
        }
      }
      throw taskDeleteErr;
    }
  }

  async getActiveTasks(): Promise<Task[]> {
    return this.repo.findAll({
      status: ["todo", "scheduled", "in_progress", "deferred"],
      excludeDeleted: true,
    });
  }

  async completeTask(
    id: string,
    opts: { completedAt?: string } = {}
  ): Promise<Task> {
    const existing = await this.repo.findById(id, { excludeDeleted: true });
    if (!existing) throw new Error("任务不存在");
    if (existing.status === "archived") throw new Error("已归档任务不可直接完成");

    const completedAt = opts.completedAt ?? new Date().toISOString();
    const task = await this.repo.update(id, {
      status: "done",
      completed_at: completedAt,
      archived_at: null,
      deferred_until: null,
    });
    await this.timeBlockService.batchCancelByTaskId(id, { onlyFuture: true });
    return task;
  }

  async skipTaskToday(id: string, now: Date = new Date()): Promise<Task> {
    const existing = await this.repo.findById(id, { excludeDeleted: true });
    if (!existing) throw new Error("任务不存在");

    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const blocks = await this.blockRepo.findByTaskId(id);
    const target = blocks.find(
      (block) =>
        !block.deleted_at &&
        (block.status === "scheduled" || block.status === "in_progress") &&
        block.start_time >= dayStart.toISOString() &&
        block.start_time < dayEnd.toISOString()
    );

    if (target) {
      await this.blockRepo.update(target.id, {
        status: "skipped",
        skipped_at: now.toISOString(),
      });
    } else {
      console.warn(`[TaskService] skipTaskToday: no active block for task ${id}`);
    }

    const futureCount = await this.getFutureActiveBlocksCount(id, now);
    return this.repo.update(id, {
      status: futureCount > 0 ? "scheduled" : "todo",
      deferred_until: null,
    });
  }

  async deferTask(id: string, until?: string): Promise<Task> {
    const existing = await this.repo.findById(id, { excludeDeleted: true });
    if (!existing) throw new Error("任务不存在");
    if (existing.status === "archived") throw new Error("已归档任务不可延期");

    const task = await this.repo.update(id, {
      status: "deferred",
      deferred_until: until ?? null,
      completed_at: null,
      archived_at: null,
    });
    await this.timeBlockService.batchCancelByTaskId(id, { onlyFuture: true });
    return task;
  }

  async reopenTask(id: string): Promise<Task> {
    const existing = await this.repo.findById(id, { excludeDeleted: true });
    if (!existing) throw new Error("任务不存在");
    if (!["done", "cancelled", "deferred", "archived"].includes(existing.status)) {
      return existing;
    }

    const activeCount = await this.blockRepo.countActiveByTaskId(id);
    return this.repo.update(id, {
      status: activeCount > 0 ? "scheduled" : "todo",
      archived_at: null,
      completed_at: null,
      deferred_until: null,
    });
  }

  async archiveTask(id: string, opts: { archivedAt?: string } = {}): Promise<Task> {
    const existing = await this.repo.findById(id, { excludeDeleted: true });
    if (!existing) throw new Error("任务不存在");
    if (existing.status !== "done" && existing.status !== "cancelled") {
      throw new Error("只有已完成或已取消任务可以归档");
    }

    return this.repo.update(id, {
      status: "archived",
      archived_at: opts.archivedAt ?? new Date().toISOString(),
    });
  }

  async unarchiveTask(id: string): Promise<Task> {
    const existing = await this.repo.findById(id, { excludeDeleted: true });
    if (!existing) throw new Error("任务不存在");
    if (existing.status !== "archived" && !existing.archived_at) {
      throw new Error("该任务未归档");
    }

    return this.repo.update(id, {
      status: existing.completed_at ? "done" : "todo",
      archived_at: null,
    });
  }

  async batchDeleteTasks(ids: string[]): Promise<{ deletedIds: string[] }> {
    if (ids.length === 0) throw new Error("批量删除至少需要选择一个任务");

    const deletedIds: string[] = [];
    for (const id of ids) {
      const existing = await this.repo.findById(id, { excludeDeleted: true });
      if (!existing) continue;
      await this.deleteTask(id);
      deletedIds.push(id);
    }
    return { deletedIds };
  }

  async autoArchiveStaleDone(
    thresholdDays = 7,
    now: Date = new Date()
  ): Promise<{ archived: Task[] }> {
    const cutoff = new Date(now.getTime() - thresholdDays * 24 * 60 * 60 * 1000);
    const tasks = await this.repo.findAll({
      status: "done",
      excludeDeleted: true,
      includeArchived: true,
    });
    const staleTasks = tasks.filter(
      (task) =>
        !task.archived_at &&
        task.completed_at !== undefined &&
        new Date(task.completed_at).getTime() < cutoff.getTime()
    );

    const archived: Task[] = [];
    for (const task of staleTasks) {
      archived.push(await this.archiveTask(task.id));
    }

    return { archived };
  }

  /**
   * V2：统计某个 Task 在指定时间点之后还有多少个活跃 TimeBlock。
   * 用于 HeartbeatService 判断完成/跳过/延迟一个 TimeBlock 后，Task 是否还有后续安排。
   * "活跃"定义：start_time > afterTime，status 为 scheduled 或 in_progress，未软删除。
   */
  async getFutureActiveBlocksCount(taskId: string, afterTime: Date): Promise<number> {
    const afterTimeStr = afterTime.toISOString();
    const blocks = await this.blockRepo.findByTaskId(taskId);
    return blocks.filter(
      (b) =>
        !b.deleted_at &&
        (b.status === "scheduled" || b.status === "in_progress") &&
        b.start_time > afterTimeStr
    ).length;
  }
}
