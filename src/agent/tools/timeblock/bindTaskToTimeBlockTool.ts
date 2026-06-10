import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { ScheduleService } from "@/services/ScheduleService";
import type { ScheduleTaskInput } from "@/services/ScheduleService";

export class BindTaskToTimeBlockTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "bind_task_to_time_block",
    skill: "time_management",
    description: "Schedule a task into a time block",
    inputSchema: z.object({
      taskId: z.string(),
      startTime: z.string(),
      endTime: z.string(),
    }).passthrough(),
    outputSchema: z.any(),
    readOnly: false,
    businessSideEffects: ["timeblock"],
    observabilitySideEffects: ["agent_trace_step", "semantic_event"],
    riskLevel: "low",
    requiresConfirmation: false,
    reversible: true,
    failureRecovery: "manual",
    batchAware: false,
    idempotent: false,
    auditLevel: "trace",
    permissions: ["write:timeblocks"],
  };

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
        startTime: (args.start_time ?? args.startTime) as string,
        endTime: (args.end_time ?? args.endTime) as string,
      };

      if (!input.taskId) return this.failure("Missing task ID");
      if (!input.startTime || !input.endTime)
        return this.failure("Missing start or end time");

      const block = await this.scheduleService.scheduleTaskToTimeBlock(input);
      return this.success(
        `Scheduled task from ${block.start_time} to ${block.end_time}`,
        block
      );
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
