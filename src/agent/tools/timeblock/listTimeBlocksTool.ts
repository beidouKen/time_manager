import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";
import { formatTime } from "@/lib/dateUtils";

export class ListTimeBlocksTool extends BaseTool {
  name = "list_time_blocks";
  description = "列出指定日期的时间块";
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

      const blocks = await this.timeBlockService.getBlocksForDate(date);

      if (blocks.length === 0) {
        return this.success("该日期没有时间块安排", []);
      }

      const summary = blocks
        .map(
          (b, i) =>
            `${i + 1}. ${formatTime(b.start_time)}-${formatTime(b.end_time)} ${b.title}（${b.type}/${b.status}）`
        )
        .join("\n");

      return this.success(
        `共 ${blocks.length} 个时间块:\n${summary}`,
        blocks
      );
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
