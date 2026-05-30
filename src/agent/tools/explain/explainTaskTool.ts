import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";
import { formatTime, formatDuration } from "@/lib/dateUtils";

export class ExplainTaskTool extends BaseTool {
  name = "explain_task";
  description = "解释一个任务的状态和排期信息";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  private taskService: TaskService;
  private timeBlockService: TimeBlockService;

  constructor(taskService?: TaskService, timeBlockService?: TimeBlockService) {
    super();
    this.taskService = taskService ?? new TaskService();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const taskId = args.taskId as string;
      if (!taskId) return this.failure("缺少任务 ID");

      const task = await this.taskService.getTaskById(taskId);
      if (!task) return this.failure("任务不存在");

      const blocks = await this.timeBlockService.getBlocksByTaskId(taskId);
      const activeBlocks = blocks.filter((b) => !b.deleted_at);

      const parts: string[] = [
        `任务: ${task.title}`,
        `状态: ${task.status}`,
        `优先级: ${task.priority}`,
      ];

      if (task.deadline) parts.push(`截止日期: ${task.deadline}`);
      if (task.estimated_duration_minutes)
        parts.push(`预计时长: ${formatDuration(task.estimated_duration_minutes)}`);

      if (activeBlocks.length > 0) {
        parts.push(`\n已安排 ${activeBlocks.length} 个时间块:`);
        activeBlocks.forEach((b, i) => {
          parts.push(
            `  ${i + 1}. ${formatTime(b.start_time)}-${formatTime(b.end_time)}（${b.status}）`
          );
        });
      } else {
        parts.push("\n尚未安排时间块");
      }

      return this.success(parts.join("\n"), { task, timeBlocks: activeBlocks });
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
