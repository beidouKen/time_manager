import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";
import { TaskService } from "@/services/TaskService";
import { formatTime } from "@/lib/dateUtils";

export class GetTodayPlanTool extends BaseTool {
  name = "get_today_plan";
  description = "获取今日的完整计划（时间块 + 未安排任务）";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  private timeBlockService: TimeBlockService;
  private taskService: TaskService;

  constructor(timeBlockService?: TimeBlockService, taskService?: TaskService) {
    super();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
    this.taskService = taskService ?? new TaskService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const dateStr = args.date as string | undefined;
      const date = dateStr ? new Date(dateStr) : new Date();

      const blocks = await this.timeBlockService.getBlocksForDate(date);
      const activeBlocks = blocks.filter(
        (b) => b.status !== "cancelled" && b.status !== "skipped"
      );

      const unscheduledTasks = await this.taskService.getTasks({
        status: ["todo"],
        excludeDeleted: true,
      });

      const parts: string[] = [];

      if (activeBlocks.length > 0) {
        parts.push("【今日时间安排】");
        activeBlocks.forEach((b, i) => {
          const statusMark = b.status === "done" ? "✓" : "○";
          parts.push(
            `${statusMark} ${i + 1}. ${formatTime(b.start_time)}-${formatTime(b.end_time)} ${b.title}`
          );
        });
      } else {
        parts.push("今日暂无时间安排");
      }

      if (unscheduledTasks.length > 0) {
        parts.push(`\n【待安排任务】（${unscheduledTasks.length} 个）`);
        unscheduledTasks.slice(0, 5).forEach((t, i) => {
          parts.push(`  ${i + 1}. ${t.title}（${t.priority}）`);
        });
        if (unscheduledTasks.length > 5) {
          parts.push(`  ...及其他 ${unscheduledTasks.length - 5} 个`);
        }
      }

      return this.success(parts.join("\n"), {
        timeBlocks: activeBlocks,
        unscheduledTasks,
      });
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
