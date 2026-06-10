import { z } from "zod";
import { TaskReadModelService } from "@/agent/read-model/TaskReadModelService";
import type { ToolManifest } from "@/agent/schemas";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { formatTime } from "@/lib/dateUtils";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";

export class GetTodayPlanTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "get_today_plan",
    skill: "time_management",
    description: "Get today's schedule and unscheduled active tasks.",
    inputSchema: z.object({
      date: z.string().optional(),
      timezone: z.string().optional(),
    }),
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
    permissions: ["read:timeblocks", "read:tasks"],
  };

  private readonly readModel: TaskReadModelService;

  constructor(readModel?: TaskReadModelService);
  constructor(timeBlockService?: TimeBlockService, taskService?: TaskService);
  constructor(
    first?: TaskReadModelService | TimeBlockService,
    taskService?: TaskService,
  ) {
    super();
    this.readModel =
      first instanceof TaskReadModelService
        ? first
        : new TaskReadModelService(
            taskService ?? new TaskService(),
            first ?? new TimeBlockService(),
          );
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const dateStr = args.date as string | undefined;
      const date = dateStr ? new Date(dateStr) : new Date();
      const timezone = String(
        args.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      );

      const [blocks, unscheduledTasks] = await Promise.all([
        this.readModel.getTodaySchedule(date, timezone),
        this.readModel.getUnscheduledTasks(),
      ]);

      let summary = "";
      if (blocks.length > 0) {
        summary +=
          "[Schedule]\n" +
          blocks
            .map(
              (block, index) =>
                `${index + 1}. ${formatTime(block.start_time)}-${formatTime(block.end_time)} ${block.title}`,
            )
            .join("\n");
      } else {
        summary += "No schedule blocks for today.";
      }

      if (unscheduledTasks.length > 0) {
        summary +=
          "\n\n[Unscheduled tasks]\n" +
          unscheduledTasks
            .map((task, index) => `${index + 1}. ${task.title}`)
            .join("\n");
      }

      return this.success(summary, { blocks, unscheduledTasks });
    } catch (error) {
      return this.failure(String(error));
    }
  }
}
