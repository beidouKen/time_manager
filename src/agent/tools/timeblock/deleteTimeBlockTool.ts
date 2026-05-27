import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";

export class DeleteTimeBlockTool extends BaseTool {
  name = "delete_time_block";
  description = "Delete a time block";
  requiresConfirmation = true;
  riskLevel = "medium" as const;

  private timeBlockService: TimeBlockService;

  constructor(timeBlockService?: TimeBlockService) {
    super();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const timeBlockId = (args.timeBlockId ?? args.blockId) as string | undefined;
      if (!timeBlockId) return this.failure("Missing time block ID");

      const block = await this.timeBlockService.getBlockById(timeBlockId);
      if (!block) return this.failure("Time block not found");

      await this.timeBlockService.deleteTimeBlock(timeBlockId);
      return this.success(`Deleted time block "${block.title}"`);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
