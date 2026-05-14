import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { ScheduleService } from "@/services/ScheduleService";

export class DetectConflictsTool extends BaseTool {
  name = "detect_conflicts";
  description = "检测指定时间段是否与现有时间块冲突";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  private scheduleService: ScheduleService;

  constructor(scheduleService?: ScheduleService) {
    super();
    this.scheduleService = scheduleService ?? new ScheduleService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const startTime = args.start_time as string;
      const endTime = args.end_time as string;
      const excludeId = args.excludeId as string | undefined;

      if (!startTime || !endTime) {
        return this.failure("缺少开始或结束时间");
      }

      const result = await this.scheduleService.checkConflicts(
        startTime,
        endTime,
        excludeId
      );

      if (result.hasConflict) {
        const titles = result.conflictingBlocks.map((b) => b.title).join("、");
        return this.success(`存在时间冲突：与「${titles}」重叠`, result);
      }

      return this.success("该时间段无冲突", result);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
