import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";
import { TaskService } from "@/services/TaskService";
import { rescheduleDay } from "@/lib/scheduler";
import { formatTime } from "@/lib/dateUtils";

export class RescheduleDayTool extends BaseTool {
  // V3.9.2: riskLevel=high, requiresConfirmation=true per HIL matrix (reschedule_day → always+preview)
  readonly manifest: ToolManifest = {
    name: "reschedule_day",
    skill: "time_management",
    description: "重新排列一天中的未完成任务（需确认）",
    inputSchema: z.object({ date: z.string().optional() }),
    outputSchema: z.any(),
    readOnly: false,
    businessSideEffects: ["timeblock"],
    observabilitySideEffects: ["agent_trace_step", "semantic_event"],
    riskLevel: "high",
    requiresConfirmation: true,
    reversible: true,
    failureRecovery: "manual",
    batchAware: true,
    idempotent: false,
    auditLevel: "trace+semantic_event",
    permissions: ["write:timeblocks"],
  };

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
      const tasks = await this.taskService.getActiveTasks();

      const result = rescheduleDay(blocks, tasks, date);

      if (result.moved.length === 0) {
        return this.success("没有需要重排的时间块");
      }

      // Apply the rescheduling
      for (const move of result.moved) {
        await this.timeBlockService.updateTimeBlock(move.blockId, {
          start_time: move.newStart,
          end_time: move.newEnd,
        });
      }

      const parts: string[] = [`已重排 ${result.moved.length} 个时间块：`];
      result.moved.forEach((m, i) => {
        parts.push(
          `  ${i + 1}. ${formatTime(m.oldStart)} → ${formatTime(m.newStart)}-${formatTime(m.newEnd)}`
        );
      });

      if (result.unscheduled.length > 0) {
        parts.push(`\n${result.unscheduled.length} 个任务无法安排：`);
        result.unscheduled.forEach((u) => {
          parts.push(`  - ${u.task.title}：${u.reason}`);
        });
      }

      return this.success(parts.join("\n"), result);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
