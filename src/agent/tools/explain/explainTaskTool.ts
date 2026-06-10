import { z } from "zod";
import { TaskReadModelService } from "@/agent/read-model/TaskReadModelService";
import type { ToolManifest } from "@/agent/schemas";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { formatDuration, formatTime } from "@/lib/dateUtils";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";
import type { Task } from "@/types/task.types";

export class ExplainTaskTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "explain_task",
    skill: "time_management",
    description: "Explain a task's status and schedule information.",
    inputSchema: z.object({ taskId: z.string() }),
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
    permissions: ["read:tasks", "read:timeblocks"],
  };

  private readonly readModel: TaskReadModelService;

  constructor(readModel?: TaskReadModelService);
  constructor(taskService?: TaskService, timeBlockService?: TimeBlockService);
  constructor(
    first?: TaskReadModelService | TaskService,
    timeBlockService?: TimeBlockService,
  ) {
    super();
    this.readModel =
      first instanceof TaskReadModelService
        ? first
        : new TaskReadModelService(
            first ?? new TaskService(),
            timeBlockService ?? new TimeBlockService(),
          );
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const taskId = args.taskId as string;
      if (!taskId) return this.failure("Missing task id.");

      const task = await this.findTask(taskId);
      if (!task) return this.failure("Task not found.");

      const { scheduled, blocks } = await this.readModel.isTaskScheduled(taskId);

      const parts: string[] = [
        `Task: ${task.title}`,
        `Status: ${task.status}`,
        `Priority: ${task.priority}`,
      ];

      if (task.deadline) parts.push(`Deadline: ${task.deadline}`);
      if (task.estimated_duration_minutes) {
        parts.push(
          `Estimated duration: ${formatDuration(task.estimated_duration_minutes)}`,
        );
      }

      if (scheduled && blocks.length > 0) {
        parts.push(`\nScheduled in ${blocks.length} time block(s):`);
        blocks.forEach((block, index) => {
          parts.push(
            `  ${index + 1}. ${formatTime(block.start_time)}-${formatTime(block.end_time)} (${block.status})`,
          );
        });
      } else {
        parts.push("\nNo active schedule blocks.");
      }

      return this.success(parts.join("\n"), { task, timeBlocks: blocks, scheduled });
    } catch (error) {
      return this.failure(String(error));
    }
  }

  private async findTask(taskId: string): Promise<Task | null> {
    const tasks = [
      ...(await this.readModel.getActiveTasks()),
      ...(await this.readModel.getCompletedTasks()),
    ];
    return tasks.find((task) => task.id === taskId) ?? null;
  }
}
