import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";
import type { UpdateTaskInput } from "@/types/task.types";

export class UpdateTaskTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "update_task",
    skill: "time_management",
    description: "更新一个已有任务的信息",
    inputSchema: z.object({ taskId: z.string() }).passthrough(),
    outputSchema: z.any(),
    readOnly: false,
    businessSideEffects: ["task"],
    observabilitySideEffects: ["agent_trace_step", "semantic_event"],
    riskLevel: "low",
    requiresConfirmation: false,
    reversible: true,
    failureRecovery: "manual",
    batchAware: false,
    idempotent: true,
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
      const taskId = args.taskId as string;
      if (!taskId) return this.failure("缺少任务 ID");

      const patch: UpdateTaskInput = {};
      if (args.title !== undefined) patch.title = args.title as string;
      if (args.description !== undefined) patch.description = args.description as string;
      if (args.deadline !== undefined) patch.deadline = args.deadline as string | null;
      if (args.priority !== undefined)
        patch.priority = args.priority as "low" | "medium" | "high" | "urgent";
      if (args.category !== undefined) patch.category = args.category as string | null;
      if (args.estimated_duration_minutes !== undefined)
        patch.estimated_duration_minutes = args.estimated_duration_minutes as number | null;

      const task = await this.taskService.updateTask(taskId, patch);
      return this.success(`已更新任务「${task.title}」`, task);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
