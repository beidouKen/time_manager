import { SqliteTaskRepository } from "@/repositories/sqlite/SqliteTaskRepository";
import { SqliteTimeBlockRepository } from "@/repositories/sqlite/SqliteTimeBlockRepository";
import type { ITaskRepository } from "@/repositories/interfaces/ITaskRepository";
import type { ITimeBlockRepository } from "@/repositories/interfaces/ITimeBlockRepository";
import type { TimeBlock } from "@/types/timeblock.types";
import { getDayRange } from "@/lib/dateUtils";
import { detectConflicts, type ConflictResult } from "@/lib/conflictDetector";

export interface ScheduleTaskInput {
  taskId: string;
  title: string;
  startTime: string;
  endTime: string;
  /**
   * V3.8+: 补记模式时传入 "done"，创建历史已完成记录。
   * 默认 undefined → 沿用原有 "scheduled" 逻辑。
   */
  initialStatus?: "scheduled" | "done";
}

export interface MoveBackResult {
  timeBlockId: string;
  taskId: string;
  taskStatusUpdatedTo: "todo" | "scheduled";
}

export class ScheduleService {
  private taskRepo: ITaskRepository;
  private blockRepo: ITimeBlockRepository;

  constructor(taskRepo?: ITaskRepository, blockRepo?: ITimeBlockRepository) {
    this.taskRepo = taskRepo ?? new SqliteTaskRepository();
    this.blockRepo = blockRepo ?? new SqliteTimeBlockRepository();
  }

  /**
   * Check for time conflicts among blocks on the same day.
   */
  async checkConflicts(
    startTime: string,
    endTime: string,
    excludeId?: string
  ): Promise<ConflictResult> {
    const { start, end } = getDayRange(new Date(startTime));
    const blocks = await this.blockRepo.findByDateRange(start, end);
    return detectConflicts(blocks, startTime, endTime, excludeId);
  }

  /**
   * Core operation ①: Schedule a task to a time block.
   * Creates a TimeBlock linked to the task and updates task status to 'scheduled'.
   */
  async scheduleTaskToTimeBlock(input: ScheduleTaskInput): Promise<TimeBlock> {
    const { taskId, title, startTime, endTime, initialStatus } = input;
    const isBackfill = initialStatus === "done";

    // Validate task exists
    const task = await this.taskRepo.findById(taskId, { excludeDeleted: true });
    if (!task) throw new Error("任务不存在");
    // V3.8+: 补记模式允许对任何状态的任务追加历史时间块
    if (
      !isBackfill &&
      (task.status === "done" || task.status === "cancelled" || task.status === "archived")
    ) {
      throw new Error(`任务状态为 ${task.status}，无法安排时间块`);
    }

    // Check time validity
    if (endTime <= startTime) {
      throw new Error("结束时间必须晚于开始时间");
    }

    // Check conflicts（补记历史记录同样检查冲突，避免数据混乱）
    const conflictResult = await this.checkConflicts(startTime, endTime);
    if (conflictResult.hasConflict) {
      const conflictTitles = conflictResult.conflictingBlocks
        .map((b) => b.title)
        .join("、");
      throw new Error(`时间冲突：与「${conflictTitles}」重叠，请调整时间`);
    }

    // Create time block
    let block = await this.blockRepo.create({
      task_id: taskId,
      title,
      start_time: startTime,
      end_time: endTime,
      type: "task",
      source: "manual",
    });

    if (isBackfill) {
      block = await this.blockRepo.update(block.id, {
        status: "done",
        completed_at: new Date().toISOString(),
      });
    }

    // V3.8+: 补记模式 → 将任务标记为已完成；普通安排 → 标记为 scheduled
    await this.taskRepo.update(taskId, {
      status: isBackfill ? "done" : "scheduled",
      completed_at: isBackfill ? new Date().toISOString() : null,
      archived_at: null,
      deferred_until: null,
    });

    return block;
  }

  /**
   * Core operation ②: Move a time block back to the task list.
   * Soft-deletes the TimeBlock and updates task status back to 'todo' if no other blocks remain.
   */
  async moveTimeBlockBackToTask(timeBlockId: string): Promise<MoveBackResult> {
    const block = await this.blockRepo.findById(timeBlockId, { excludeDeleted: true });
    if (!block) throw new Error("时间块不存在");

    // Guard: only task-type blocks with a task_id can be moved back
    if (!block.task_id) {
      throw new Error("该时间块未绑定任务，无法移回 Todo");
    }
    if (block.type !== "task") {
      throw new Error("只有任务类型的时间块才能移回 Todo");
    }

    // Guard: done blocks cannot be moved back (V0 simple stable approach)
    if (block.status === "done") {
      throw new Error("已完成的时间块不可移回，如需重做请新建任务");
    }
    if (block.status === "in_progress") {
      throw new Error("进行中的时间块请先标记完成或取消后再移回");
    }

    const taskId = block.task_id;

    // Soft-delete the time block
    await this.blockRepo.softDelete(timeBlockId);

    // Count remaining active time blocks for this task
    const remainingCount = await this.blockRepo.countActiveByTaskId(taskId);

    // Determine new task status
    const newTaskStatus = remainingCount > 0 ? "scheduled" : "todo";
    await this.taskRepo.update(taskId, { status: newTaskStatus });

    return {
      timeBlockId,
      taskId,
      taskStatusUpdatedTo: newTaskStatus,
    };
  }
}
