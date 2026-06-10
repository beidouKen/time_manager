import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";
import type { CreateTaskInput } from "@/types/task.types";

export class CreateTaskTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "create_task",
    skill: "time_management",
    description: "创建一个新任务",
    inputSchema: z.object({ title: z.string() }).passthrough(),
    outputSchema: z.any(),
    readOnly: false,
    businessSideEffects: ["task"],
    observabilitySideEffects: ["agent_trace_step", "semantic_event"],
    riskLevel: "low",
    requiresConfirmation: false,
    reversible: true,
    failureRecovery: "manual",
    batchAware: false,
    idempotent: false,
    auditLevel: "trace",
    permissions: ["write:tasks"],
  };

  private taskService: TaskService;

  constructor(taskService?: TaskService) {
    super();
    this.taskService = taskService ?? new TaskService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const input: CreateTaskInput = {
        title: args.title as string,
        description: args.description as string | undefined,
        deadline: args.deadline as string | undefined,
        estimated_duration_minutes: args.duration as number | undefined,
        priority: args.priority as "low" | "medium" | "high" | "urgent" | undefined,
        category: args.category as string | undefined,
      };

      const task = await this.taskService.createTask(input);
      return this.success(`已创建任务「${task.title}」`, task);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
