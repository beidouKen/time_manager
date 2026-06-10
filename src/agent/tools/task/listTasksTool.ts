import { z } from "zod";
import { TaskReadModelService } from "@/agent/read-model/TaskReadModelService";
import type { ToolManifest } from "@/agent/schemas";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";
import type { Task } from "@/types/task.types";

type ListTasksFilter =
  | "all"
  | "active"
  | "unscheduled"
  | "scheduled"
  | "completed";

export class ListTasksTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "list_tasks",
    skill: "time_management",
    description: "List tasks by read-model filter.",
    inputSchema: z
      .object({
        filter: z
          .enum(["all", "active", "unscheduled", "scheduled", "completed"])
          .optional(),
        status: z.string().optional(),
      })
      .passthrough(),
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
    permissions: ["read:tasks"],
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
      const filter = normalizeFilter(args);
      const tasks = await this.getTasks(filter);

      if (tasks.length === 0) {
        return this.success("No tasks found.", []);
      }

      const summary = tasks
        .map(
          (task, index) =>
            `${index + 1}. ${task.title} (${task.status}, priority: ${task.priority})`,
        )
        .join("\n");

      return this.success(`Found ${tasks.length} task(s)\n${summary}`, tasks);
    } catch (error) {
      return this.failure(String(error));
    }
  }

  private async getTasks(filter: ListTasksFilter): Promise<Task[]> {
    switch (filter) {
      case "all":
        return dedupeTasks([
          ...(await this.readModel.getActiveTasks()),
          ...(await this.readModel.getCompletedTasks()),
        ]);
      case "scheduled":
        return this.readModel.getScheduledTasks();
      case "completed":
        return this.readModel.getCompletedTasks();
      case "unscheduled":
        return this.readModel.getUnscheduledTasks();
      case "active":
      default:
        return this.readModel.getActiveTasks();
    }
  }
}

function normalizeFilter(args: Record<string, unknown>): ListTasksFilter {
  const raw = args.filter ?? args.status;
  if (
    raw === "all" ||
    raw === "active" ||
    raw === "unscheduled" ||
    raw === "scheduled" ||
    raw === "completed"
  ) {
    return raw;
  }
  if (raw === "done") return "completed";
  return "active";
}

function dedupeTasks(tasks: Task[]): Task[] {
  return Array.from(new Map(tasks.map((task) => [task.id, task])).values());
}
