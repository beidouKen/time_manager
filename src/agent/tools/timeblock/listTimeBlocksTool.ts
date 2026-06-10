import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";
import { formatTime } from "@/lib/dateUtils";

export class ListTimeBlocksTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "list_time_blocks",
    skill: "time_management",
    description: "列出指定日期的时间块",
    inputSchema: z.object({ date: z.string().optional() }),
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
