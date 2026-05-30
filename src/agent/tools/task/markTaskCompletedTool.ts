import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";

export class MarkTaskCompletedTool extends BaseTool {
  name = "mark_task_completed";
  description = "将一个任务标记为已完成";
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

      const task = await this.taskService.updateTaskStatus(taskId, "done");
      return this.success(`已将任务「${task.title}」标记为完成`, task);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
