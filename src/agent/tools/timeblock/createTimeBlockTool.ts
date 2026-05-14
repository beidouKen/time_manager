import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";
import type { CreateTimeBlockInput } from "@/types/timeblock.types";

export class CreateTimeBlockTool extends BaseTool {
  name = "create_time_block";
  description = "创建一个新的时间块";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  private timeBlockService: TimeBlockService;

  constructor(timeBlockService?: TimeBlockService) {
    super();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const input: CreateTimeBlockInput = {
        title: args.title as string,
        start_time: args.start_time as string,
        end_time: args.end_time as string,
        type: (args.type as "task" | "event" | "break" | "routine") ?? "task",
        task_id: args.task_id as string | undefined,
        is_locked: (args.is_locked as boolean) ?? false,
        source: "system",
      };

      const block = await this.timeBlockService.createTimeBlock(input);
      return this.success(`已创建时间块「${block.title}」`, block);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
