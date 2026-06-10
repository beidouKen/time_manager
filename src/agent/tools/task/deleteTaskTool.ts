import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";

export class DeleteTaskTool extends BaseTool {
  // V3.9.2: ToolManifest — template B (destructive, always requiresConfirmation)
  readonly manifest: ToolManifest = {
    name: "delete_task",
    skill: "time_management",
    description: "删除一个任务（软删除，同时联动删除关联时间块）",
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: z.object({ success: z.boolean() }),
    readOnly: false,
    businessSideEffects: ["task", "timeblock"],
    observabilitySideEffects: ["agent_trace_step", "semantic_event"],
    riskLevel: "high",
    requiresConfirmation: true,
    reversible: true,
    failureRecovery: "manual",
    batchAware: false,
    idempotent: false,
    auditLevel: "trace+semantic_event",
    permissions: ["write:tasks", "write:timeblocks"],
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

      const task = await this.taskService.getTaskById(taskId);
      if (!task) return this.failure("任务不存在");

      await this.taskService.deleteTask(taskId);
      return this.success(`已删除任务「${task.title}」及其关联时间块`);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
