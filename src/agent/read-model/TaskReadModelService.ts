import {
  ACTIVE_TASK_STATUSES,
  COMPLETED_TASK_STATUSES,
  type DayRange,
  isActiveTask,
  isCompletedTask,
  isDisplayableScheduleBlock,
  isInDayRange,
  isScheduledTask,
  isUnscheduledTask,
} from "@/agent/schemas/ReadModel";
import { HeartbeatService } from "@/services/HeartbeatService";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";
import type { Task } from "@/types/task.types";
import type { TimeBlock } from "@/types/timeblock.types";

export class TaskReadModelService {
  constructor(
    private readonly taskService: TaskService,
    private readonly timeBlockService: TimeBlockService,
    private readonly heartbeat: HeartbeatService = new HeartbeatService(),
  ) {}

  async getActiveTasks(): Promise<Task[]> {
    const tasks = await this.taskService.getTasks({
      status: [...ACTIVE_TASK_STATUSES],
      excludeDeleted: true,
    });
    return tasks.filter(isActiveTask);
  }

  async getUnscheduledTasks(): Promise<Task[]> {
    const tasks = await this.getActiveTasks();
    const pairs = await Promise.all(
      tasks.map(async (task) => ({
        task,
        blocks: await this.timeBlockService.getBlocksByTaskId(task.id),
      })),
    );
    return pairs
      .filter(({ task, blocks }) => isUnscheduledTask(task, blocks))
      .map(({ task }) => task);
  }

  async getScheduledTasks(): Promise<Task[]> {
    const tasks = await this.getActiveTasks();
    const pairs = await Promise.all(
      tasks.map(async (task) => ({
        task,
        blocks: await this.timeBlockService.getBlocksByTaskId(task.id),
      })),
    );
    return pairs
      .filter(({ task, blocks }) => isScheduledTask(task, blocks))
      .map(({ task }) => task);
  }

  async getCompletedTasks(
    opts: { sinceISO?: string; limit?: number } = {},
  ): Promise<Task[]> {
    const tasks = await this.taskService.getTasks({
      status: [...COMPLETED_TASK_STATUSES],
      excludeDeleted: true,
    });
    let completed = tasks.filter(isCompletedTask);
    if (opts.sinceISO) {
      completed = completed.filter(
        (task) => (task.completed_at ?? task.updated_at) >= opts.sinceISO!,
      );
    }
    completed = completed.sort((a, b) =>
      (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at),
    );
    return opts.limit ? completed.slice(0, opts.limit) : completed;
  }

  async isTaskScheduled(
    taskId: string,
  ): Promise<{ scheduled: boolean; blocks: TimeBlock[] }> {
    const task = await this.taskService.getTaskById(taskId);
    if (!task) return { scheduled: false, blocks: [] };
    const blocks = await this.timeBlockService.getBlocksByTaskId(taskId);
    const activeBlocks = blocks.filter((block) => !block.deleted_at);
    return {
      scheduled: isScheduledTask(task, blocks),
      blocks: activeBlocks.sort((a, b) => a.start_time.localeCompare(b.start_time)),
    };
  }

  async getTodaySchedule(date: Date, _tz: string): Promise<TimeBlock[]> {
    const range = toDayRange(date);
    const blocks = await this.timeBlockService.getBlocksForDate(date);
    return blocks
      .filter(
        (block) =>
          isDisplayableScheduleBlock(block) && isInDayRange(block, range),
      )
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  async getCurrentFocus(now: Date): Promise<TimeBlock | null> {
    const blocks = await this.timeBlockService.getBlocksForDate(now);
    return this.heartbeat.getCurrentFocus(blocks, now);
  }
}

function toDayRange(date: Date): DayRange {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}
