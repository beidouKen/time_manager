import type { TimeBlock } from "@/types/timeblock.types";
import { doIntervalsOverlap } from "./dateUtils";

export interface ConflictResult {
  hasConflict: boolean;
  conflictingBlocks: TimeBlock[];
}

/**
 * Check if a proposed time range conflicts with existing time blocks.
 * @param blocks - existing active time blocks
 * @param startTime - proposed start (ISO string)
 * @param endTime - proposed end (ISO string)
 * @param excludeId - optional block id to exclude (for update operations)
 */
export function detectConflicts(
  blocks: TimeBlock[],
  startTime: string,
  endTime: string,
  excludeId?: string
): ConflictResult {
  const conflictingBlocks = blocks.filter((block) => {
    if (block.id === excludeId) return false;
    if (block.deleted_at) return false;
    if (
      block.status === "cancelled" ||
      block.status === "skipped" ||
      block.status === "done"
    ) {
      return false;
    }
    return doIntervalsOverlap(
      startTime,
      endTime,
      block.start_time,
      block.end_time
    );
  });

  return {
    hasConflict: conflictingBlocks.length > 0,
    conflictingBlocks,
  };
}
