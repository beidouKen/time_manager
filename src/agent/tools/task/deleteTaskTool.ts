import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";

export class DeleteTaskTool extends BaseTool {
  name = "delete_task";
  description = "删除一个任务（软删除，同时联动删除关联时间块）";
  requiresConfirmation = true;
  riskLevel = "high" as const;

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
