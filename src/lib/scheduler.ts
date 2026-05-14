import type { Task } from "@/types/task.types";
import type { TimeBlock } from "@/types/timeblock.types";
import type { FreeSlot } from "@/agent/tools/schedule/getFreeSlotsTool";

export interface ScheduleRequest {
  task: Task;
  preferredDate: Date;
  preferredTimeOfDay?: string; // "morning" | "afternoon" | "evening"
  durationMinutes: number;
}

export interface ScheduleResult {
  scheduled: Array<{
    task: Task;
    startTime: string;
    endTime: string;
  }>;
  unscheduled: Array<{
    task: Task;
    reason: string;
  }>;
}

export interface RescheduleResult {
  moved: Array<{
    blockId: string;
    oldStart: string;
    oldEnd: string;
    newStart: string;
    newEnd: string;
  }>;
  kept: TimeBlock[];
  unscheduled: Array<{
    task: Task;
    reason: string;
  }>;
}

function getTimeOfDayRange(
  date: Date,
  timeOfDay?: string
): { start: Date; end: Date } {
  const start = new Date(date);
  const end = new Date(date);

  switch (timeOfDay) {
    case "morning":
    case "上午":
    case "早上":
      start.setHours(8, 0, 0, 0);
      end.setHours(12, 0, 0, 0);
      break;
    case "afternoon":
    case "下午":
      start.setHours(13, 0, 0, 0);
      end.setHours(18, 0, 0, 0);
      break;
    case "evening":
    case "晚上":
      start.setHours(18, 0, 0, 0);
      end.setHours(22, 0, 0, 0);
      break;
    default:
      start.setHours(8, 0, 0, 0);
      end.setHours(22, 0, 0, 0);
      break;
  }

  return { start, end };
}

/**
 * Find free time slots within a date range, given existing blocks.
 */
export function findFreeSlots(
  existingBlocks: TimeBlock[],
  rangeStart: Date,
  rangeEnd: Date,
  minDurationMinutes = 30
): FreeSlot[] {
  const activeBlocks = existingBlocks
    .filter(
      (b) =>
        !b.deleted_at &&
        b.status !== "cancelled" &&
        b.status !== "skipped"
    )
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const freeSlots: FreeSlot[] = [];
  let cursor = rangeStart.toISOString();

  for (const block of activeBlocks) {
    if (block.end_time <= rangeStart.toISOString()) continue;
    if (block.start_time >= rangeEnd.toISOString()) break;

    if (block.start_time > cursor) {
      const gapMs =
        new Date(block.start_time).getTime() - new Date(cursor).getTime();
      const gapMinutes = gapMs / 60000;
      if (gapMinutes >= minDurationMinutes) {
        freeSlots.push({
          start: cursor,
          end: block.start_time,
          durationMinutes: Math.round(gapMinutes),
        });
      }
    }
    if (block.end_time > cursor) {
      cursor = block.end_time;
    }
  }

  // Gap after last block
  if (cursor < rangeEnd.toISOString()) {
    const gapMs =
      rangeEnd.getTime() - new Date(cursor).getTime();
    const gapMinutes = gapMs / 60000;
    if (gapMinutes >= minDurationMinutes) {
      freeSlots.push({
        start: cursor,
        end: rangeEnd.toISOString(),
        durationMinutes: Math.round(gapMinutes),
      });
    }
  }

  return freeSlots;
}

/**
 * Find the best slot for a task considering its duration and preferred time.
 */
export function findBestSlot(
  request: ScheduleRequest,
  existingBlocks: TimeBlock[]
): { startTime: string; endTime: string } | null {
  const { preferredDate, preferredTimeOfDay, durationMinutes } = request;
  const { start, end } = getTimeOfDayRange(preferredDate, preferredTimeOfDay);

  const slots = findFreeSlots(existingBlocks, start, end, durationMinutes);

  if (slots.length === 0) return null;

  // Pick the first slot that fits
  const bestSlot = slots.find((s) => s.durationMinutes >= durationMinutes);
  if (!bestSlot) return null;

  const slotStart = new Date(bestSlot.start);
  const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

  return {
    startTime: slotStart.toISOString(),
    endTime: slotEnd.toISOString(),
  };
}

/**
 * Sort tasks by scheduling priority:
 * 1. Deadline proximity (closer = higher priority)
 * 2. Priority level (urgent > high > medium > low)
 * 3. Duration (longer tasks get priority to find contiguous blocks)
 */
export function sortTasksBySchedulingPriority(tasks: Task[]): Task[] {
  const priorityWeight: Record<string, number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  return [...tasks].sort((a, b) => {
    // Deadline proximity
    if (a.deadline && b.deadline) {
      const deadlineDiff =
        new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      if (deadlineDiff !== 0) return deadlineDiff;
    } else if (a.deadline && !b.deadline) {
      return -1;
    } else if (!a.deadline && b.deadline) {
      return 1;
    }

    // Priority level
    const pDiff =
      (priorityWeight[b.priority] ?? 2) - (priorityWeight[a.priority] ?? 2);
    if (pDiff !== 0) return pDiff;

    // Duration (longer first)
    return (b.estimated_duration_minutes ?? 0) - (a.estimated_duration_minutes ?? 0);
  });
}

/**
 * Determine which blocks are movable during a reschedule.
 * Immovable: locked, event, routine, done, cancelled.
 */
export function getMovableBlocks(blocks: TimeBlock[]): {
  movable: TimeBlock[];
  immovable: TimeBlock[];
} {
  const movable: TimeBlock[] = [];
  const immovable: TimeBlock[] = [];

  for (const block of blocks) {
    if (block.deleted_at) continue;

    const isImmovable =
      block.is_locked ||
      block.type === "event" ||
      block.type === "routine" ||
      block.status === "done" ||
      block.status === "cancelled";

    if (isImmovable) {
      immovable.push(block);
    } else {
      movable.push(block);
    }
  }

  return { movable, immovable };
}

/**
 * Reschedule movable blocks within a day, respecting immovable ones.
 * Returns new time assignments for movable blocks sorted by priority.
 */
export function rescheduleDay(
  allBlocks: TimeBlock[],
  tasks: Task[],
  date: Date
): RescheduleResult {
  const { movable, immovable } = getMovableBlocks(allBlocks);

  const dayStart = new Date(date);
  dayStart.setHours(8, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(22, 0, 0, 0);

  // Get free slots using only immovable blocks as constraints
  const freeSlots = findFreeSlots(immovable, dayStart, dayEnd, 15);

  // Sort movable blocks by their task priority
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const sortedMovable = [...movable].sort((a, b) => {
    const taskA = a.task_id ? taskMap.get(a.task_id) : undefined;
    const taskB = b.task_id ? taskMap.get(b.task_id) : undefined;
    const priorityWeight: Record<string, number> = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    const pA = taskA ? (priorityWeight[taskA.priority] ?? 2) : 2;
    const pB = taskB ? (priorityWeight[taskB.priority] ?? 2) : 2;
    return pB - pA;
  });

  const moved: RescheduleResult["moved"] = [];
  const unscheduled: RescheduleResult["unscheduled"] = [];

  let slotIdx = 0;
  let slotCursor: string = freeSlots[0]?.start ?? "";

  for (const block of sortedMovable) {
    const durationMs =
      new Date(block.end_time).getTime() - new Date(block.start_time).getTime();
    const durationMinutes = durationMs / 60000;

    let placed = false;

    while (slotIdx < freeSlots.length) {
      const slot = freeSlots[slotIdx];
      const cursorTime: string = slotCursor || slot.start;
      const remainingMs =
        new Date(slot.end).getTime() - new Date(cursorTime).getTime();
      const remainingMinutes = remainingMs / 60000;

      if (remainingMinutes >= durationMinutes) {
        const newStart: string = cursorTime;
        const newEnd: string = new Date(
          new Date(cursorTime).getTime() + durationMs
        ).toISOString();

        moved.push({
          blockId: block.id,
          oldStart: block.start_time,
          oldEnd: block.end_time,
          newStart,
          newEnd,
        });

        slotCursor = newEnd;
        placed = true;
        break;
      } else {
        slotIdx++;
        slotCursor = freeSlots[slotIdx]?.start ?? "";
      }
    }

    if (!placed) {
      const task = block.task_id ? taskMap.get(block.task_id) : undefined;
      unscheduled.push({
        task: task ?? ({
          id: block.id,
          title: block.title,
          priority: "medium",
          status: "todo",
        } as Task),
        reason: "无足够空闲时间段",
      });
    }
  }

  return { moved, kept: immovable, unscheduled };
}
