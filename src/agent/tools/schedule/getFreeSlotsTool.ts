import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";
import { findFreeSlots } from "@/lib/scheduler";
import { formatTime } from "@/lib/dateUtils";

/** Exported for re-use in scheduler.ts and other modules. */
export interface FreeSlot {
  start: string;
  end: string;
  durationMinutes: number;
}

export class GetFreeSlotsTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "get_free_slots",
    skill: "time_management",
    description: "查找指定日期的空闲时间段",
    inputSchema: z.object({
      date: z.string().optional(),
      minDurationMinutes: z.number().optional(),
    }),
    outputSchema: z.array(z.any()),
    readOnly: true,
    businessSideEffects: [],
    observabilitySideEffects: ["agent_trace_step"],
    riskLevel: "low",
    requiresConfirmation: false,
    reversible: true,
    batchAware: false,
    idempotent: true,
    auditLevel: "trace",
    permissions: ["read:timeblocks"],
  };

  private timeBlockService: TimeBlockService;

  constructor(timeBlockService?: TimeBlockService) {
    super();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const dateStr = args.date as string | undefined;
      const minMinutes = (args.minDurationMinutes ?? 30) as number;
      const date = dateStr ? new Date(dateStr) : new Date();

      const dayStart = new Date(date);
      dayStart.setHours(8, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(22, 0, 0, 0);

      const blocks = await this.timeBlockService.getBlocksForDate(date);
      const freeSlots = findFreeSlots(blocks, dayStart, dayEnd, minMinutes);

      if (freeSlots.length === 0) {
        return this.success("当天没有满足最小时长的空闲时间段", []);
      }

      const summary = freeSlots
        .map(
          (s: FreeSlot, i: number) =>
            `${i + 1}. ${formatTime(s.start)}-${formatTime(s.end)}（${s.durationMinutes} 分钟）`
        )
        .join("\n");

      return this.success(
        `共 ${freeSlots.length} 个空闲时间段:\n${summary}`,
        freeSlots
      );
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
