import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";
import type { UpdateTimeBlockInput } from "@/types/timeblock.types";

export class UpdateTimeBlockTool extends BaseTool {
  name = "update_time_block";
  description = "Update a time block";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  private timeBlockService: TimeBlockService;

  constructor(timeBlockService?: TimeBlockService) {
    super();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const timeBlockId = (args.timeBlockId ?? args.blockId) as string | undefined;
      if (!timeBlockId) return this.failure("Missing time block ID");

      const patch: UpdateTimeBlockInput = {};
      if (args.title !== undefined) patch.title = args.title as string;
      if (args.start_time !== undefined) patch.start_time = args.start_time as string;
      if (args.end_time !== undefined) patch.end_time = args.end_time as string;
      if (args.type !== undefined)
        patch.type = args.type as "task" | "event" | "break" | "routine";
      if (args.status !== undefined)
        patch.status = args.status as "scheduled" | "in_progress" | "done" | "skipped" | "cancelled";

      const block = await this.timeBlockService.updateTimeBlock(timeBlockId, patch);
      return this.success(`Updated time block "${block.title}"`, block);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
