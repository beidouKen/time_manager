import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";

export class DeleteTimeBlockTool extends BaseTool {
  name = "delete_time_block";
  description = "删除一个时间块（软删除）";
  requiresConfirmation = true;
  riskLevel = "medium" as const;

  private timeBlockService: TimeBlockService;

  constructor(timeBlockService?: TimeBlockService) {
    super();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const blockId = args.blockId as string;
      if (!blockId) return this.failure("缺少时间块 ID");

      const block = await this.timeBlockService.getBlockById(blockId);
      if (!block) return this.failure("时间块不存在");

      await this.timeBlockService.deleteTimeBlock(blockId);
      return this.success(`已删除时间块「${block.title}」`);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
