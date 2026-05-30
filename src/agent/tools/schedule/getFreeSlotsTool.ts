import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";
import { formatTime } from "@/lib/dateUtils";

export interface FreeSlot {
  start: string;
  end: string;
  durationMinutes: number;
}

export class GetFreeSlotsTool extends BaseTool {
  name = "get_free_slots";
  description = "查找指定日期的空闲时间段";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  private timeBlockService: TimeBlockService;

  constructor(timeBlockService?: TimeBlockService) {
    super();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const dateStr = args.date as string | undefined;
      const date = dateStr ? new Date(dateStr) : new Date();
      const minDuration = (args.minDurationMinutes as number) ?? 30;

      const dayStart = new Date(date);
      dayStart.setHours(8, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(22, 0, 0, 0);

      const blocks = await this.timeBlockService.getBlocksForDate(date);
      const activeBlocks = blocks
        .filter(
          (b) =>
            b.status !== "cancelled" &&
            b.status !== "skipped" &&
            !b.deleted_at
        )
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

      const freeSlots: FreeSlot[] = [];
      let cursor = dayStart.toISOString();

      for (const block of activeBlocks) {
        if (block.start_time > cursor) {
          const gapMinutes =
            (new Date(block.start_time).getTime() -
              new Date(cursor).getTime()) /
            60000;
          if (gapMinutes >= minDuration) {
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

      // Check gap after last block
      if (cursor < dayEnd.toISOString()) {
        const gapMinutes =
          (dayEnd.getTime() - new Date(cursor).getTime()) / 60000;
        if (gapMinutes >= minDuration) {
          freeSlots.push({
            start: cursor,
            end: dayEnd.toISOString(),
            durationMinutes: Math.round(gapMinutes),
          });
        }
      }

      if (freeSlots.length === 0) {
        return this.success("没有找到满足条件的空闲时间段", []);
      }

      const summary = freeSlots
        .map(
          (s, i) =>
            `${i + 1}. ${formatTime(s.start)}-${formatTime(s.end)}（${s.durationMinutes}分钟）`
        )
        .join("\n");

      return this.success(
        `找到 ${freeSlots.length} 个空闲时段:\n${summary}`,
        freeSlots
      );
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
