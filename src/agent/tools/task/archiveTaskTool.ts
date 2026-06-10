import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";

export class ArchiveTaskTool extends BaseTool {
  // V3.9.2: requiresConfirmation=true per HIL matrix (action_archive_task → always)
  readonly manifest: ToolManifest = {
    name: "archive_task",
    skill: "time_management",
    description: "将一个已完成或已取消的任务归档",
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: z.any(),
    readOnly: false,
    businessSideEffects: ["task"],
    observabilitySideEffects: ["agent_trace_step", "semantic_event"],
    riskLevel: "medium",
    requiresConfirmation: true,
    reversible: true,
    failureRecovery: "manual",
    batchAware: false,
    idempotent: true,
    auditLevel: "trace+semantic_event",
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

      const task = await this.taskService.archiveTask(taskId);
      return this.success(`已将任务「${task.title}」归档`, task);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
