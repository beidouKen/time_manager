import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";
import { formatTime } from "@/lib/dateUtils";

export class ExplainScheduleTool extends BaseTool {
  name = "explain_schedule";
  description = "解释今日的排程逻辑和时间分配";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  private timeBlockService: TimeBlockService;

  constructor(timeBlockService?: TimeBlockService) {
    super();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const dateStr = args.date as string | undefined;
      const date = dateStr ? new Date(dateStr) : new Date();

      const blocks = await this.timeBlockService.getBlocksForDate(date);
      const activeBlocks = blocks.filter(
        (b) => b.status !== "cancelled" && !b.deleted_at
      );

      if (activeBlocks.length === 0) {
        return this.success("今日没有时间安排，无法解释排程逻辑");
      }

      const byType = {
        task: activeBlocks.filter((b) => b.type === "task"),
        event: activeBlocks.filter((b) => b.type === "event"),
        break_: activeBlocks.filter((b) => b.type === "break"),
        routine: activeBlocks.filter((b) => b.type === "routine"),
      };

      const totalMinutes = activeBlocks.reduce((sum, b) => {
        const ms =
          new Date(b.end_time).getTime() - new Date(b.start_time).getTime();
        return sum + ms / 60000;
      }, 0);

      const locked = activeBlocks.filter((b) => b.is_locked);

      const parts: string[] = [
        `【排程分析】`,
        `总计 ${activeBlocks.length} 个时间块，共 ${Math.round(totalMinutes)} 分钟`,
        `  任务: ${byType.task.length} 个`,
        `  事件: ${byType.event.length} 个`,
        `  休息: ${byType.break_.length} 个`,
        `  例程: ${byType.routine.length} 个`,
        `  锁定（不可移动）: ${locked.length} 个`,
      ];

      if (locked.length > 0) {
        parts.push(`\n【固定时间块】（不可移动）`);
        locked.forEach((b) => {
          parts.push(
            `  ${formatTime(b.start_time)}-${formatTime(b.end_time)} ${b.title}`
          );
        });
      }

      return this.success(parts.join("\n"), {
        blocks: activeBlocks,
        stats: {
          total: activeBlocks.length,
          totalMinutes: Math.round(totalMinutes),
          byType: {
            task: byType.task.length,
            event: byType.event.length,
            break: byType.break_.length,
            routine: byType.routine.length,
          },
          locked: locked.length,
        },
      });
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
