import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";

export class MarkTaskCompletedTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "mark_task_completed",
    skill: "time_management",
    description: "将一个任务标记为已完成",
    inputSchema: z.object({ taskId: z.string() }),
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

      const task = await this.taskService.completeTask(taskId);
      return this.success(`已将任务「${task.title}」标记为完成`, task);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
