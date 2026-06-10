import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { ScheduleService } from "@/services/ScheduleService";
import { formatTime } from "@/lib/dateUtils";

export class DetectConflictsTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "detect_conflicts",
    skill: "time_management",
    description: "检测指定时间段是否与现有时间块冲突",
    inputSchema: z.object({
      start_time: z.string(),
      end_time: z.string(),
    }).passthrough(),
    outputSchema: z.any(),
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

  private scheduleService: ScheduleService;

  constructor(scheduleService?: ScheduleService) {
    super();
    this.scheduleService = scheduleService ?? new ScheduleService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const startTime = args.start_time as string;
      const endTime = args.end_time as string;

      if (!startTime || !endTime) {
        return this.failure("缺少开始或结束时间");
      }

      const result = await this.scheduleService.checkConflicts(startTime, endTime);

      if (!result.hasConflict) {
        return this.success(
          `时间段 ${formatTime(startTime)}-${formatTime(endTime)} 没有冲突`,
          { hasConflict: false, conflicts: [] }
        );
      }

      const detail = result.conflictingBlocks
        .map(
          (b) =>
            `- ${formatTime(b.start_time)}-${formatTime(b.end_time)} ${b.title}`
        )
        .join("\n");
      return this.success(
        `发现 ${result.conflictingBlocks.length} 个冲突：\n${detail}`,
        { hasConflict: true, conflicts: result.conflictingBlocks }
      );
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
