import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";

export class ArchiveTaskTool extends BaseTool {
  name = "archive_task";
  description = "将一个已完成或已取消的任务归档";
  requiresConfirmation = false;
  riskLevel = "low" as const;

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
