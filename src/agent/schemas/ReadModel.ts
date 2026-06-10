import type { Task, TaskStatus } from "@/types/task.types";
import type { TimeBlock, TimeBlockStatus } from "@/types/timeblock.types";

export const ACTIVE_TASK_STATUSES = [
  "todo",
  "scheduled",
  "in_progress",
  "deferred",
] as const satisfies readonly TaskStatus[];

export const COMPLETED_TASK_STATUSES = [
  "done",
] as const satisfies readonly TaskStatus[];

export const TERMINAL_TASK_STATUSES = [
  "done",
  "cancelled",
  "archived",
] as const satisfies readonly TaskStatus[];

export const ACTIVE_BLOCK_TERMINAL_STATUSES = [
  "done",
  "skipped",
  "cancelled",
  "delayed",
] as const satisfies readonly TimeBlockStatus[];

export const DISPLAYABLE_SCHEDULE_BLOCK_STATUSES = [
  "scheduled",
  "in_progress",
  "done",
] as const satisfies readonly TimeBlockStatus[];

export interface DayRange {
  startISO: string;
  endISO: string;
}

export const CURRENT_FOCUS_RULE =
  "the current scheduled or in_progress timeblock delegated to HeartbeatService.getCurrentFocus";

export function isActiveBlock(block: TimeBlock): boolean {
  return (
    !block.deleted_at &&
    !(ACTIVE_BLOCK_TERMINAL_STATUSES as readonly TimeBlockStatus[]).includes(
      block.status,
    )
  );
}

export function isActiveTask(task: Task): boolean {
  if (task.deleted_at) return false;
  if (task.archived_at) return false;
  return (ACTIVE_TASK_STATUSES as readonly TaskStatus[]).includes(task.status);
}

export function isCompletedTask(task: Task): boolean {
  return !task.deleted_at && task.status === "done";
}

export function isScheduledTask(
  task: Task,
  blocksOfThisTask: TimeBlock[],
): boolean {
  if (!isActiveTask(task)) return false;
  return blocksOfThisTask.some(isActiveBlock);
}

export function isUnscheduledTask(
  task: Task,
  blocksOfThisTask: TimeBlock[],
): boolean {
  if (!isActiveTask(task)) return false;
  return !blocksOfThisTask.some(isActiveBlock);
}

export function isDisplayableScheduleBlock(block: TimeBlock): boolean {
  return (
    !block.deleted_at &&
    (DISPLAYABLE_SCHEDULE_BLOCK_STATUSES as readonly TimeBlockStatus[]).includes(
      block.status,
    )
  );
}

export function isInDayRange(block: TimeBlock, range: DayRange): boolean {
  return block.start_time >= range.startISO && block.start_time < range.endISO;
}
