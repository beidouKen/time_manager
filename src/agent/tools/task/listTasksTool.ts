import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";
import type { TaskFilter, TaskStatus } from "@/types/task.types";

export class ListTasksTool extends BaseTool {
  name = "list_tasks";
  description = "列出任务，可按状态筛选";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  private taskService: TaskService;

  constructor(taskService?: TaskService) {
    super();
    this.taskService = taskService ?? new TaskService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const filter: TaskFilter = { excludeDeleted: true };

      if (args.status) {
        filter.status = args.status as TaskStatus | TaskStatus[];
      }

      const tasks = await this.taskService.getTasks(filter);

      if (tasks.length === 0) {
        return this.success("当前没有任务", []);
      }

      const summary = tasks
        .map(
          (t, i) =>
            `${i + 1}. ${t.title}（${t.status}，优先级: ${t.priority}）`
        )
        .join("\n");

      return this.success(`共 ${tasks.length} 个任务:\n${summary}`, tasks);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
