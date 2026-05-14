import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { ScheduleService } from "@/services/ScheduleService";
import type { ScheduleTaskInput } from "@/services/ScheduleService";

export class BindTaskToTimeBlockTool extends BaseTool {
  name = "bind_task_to_time_block";
  description = "将一个任务绑定到一个时间块（排期）";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  private scheduleService: ScheduleService;

  constructor(scheduleService?: ScheduleService) {
    super();
    this.scheduleService = scheduleService ?? new ScheduleService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const input: ScheduleTaskInput = {
        taskId: args.taskId as string,
        title: args.title as string,
        startTime: args.startTime as string,
        endTime: args.endTime as string,
      };

      if (!input.taskId) return this.failure("缺少任务 ID");
      if (!input.startTime || !input.endTime)
        return this.failure("缺少开始或结束时间");

      const block =
        await this.scheduleService.scheduleTaskToTimeBlock(input);
      return this.success(
        `已将任务安排到 ${block.start_time} - ${block.end_time}`,
        block
      );
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
