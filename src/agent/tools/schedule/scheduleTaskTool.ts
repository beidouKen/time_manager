import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";
import type { TimeBlockService } from "@/services/TimeBlockService";
import { ScheduleService } from "@/services/ScheduleService";

export class ScheduleTaskTool extends BaseTool {
  name = "schedule_task";
  description = "为任务安排时间块（可自动寻找空闲时间）";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  private taskService: TaskService;
  private scheduleService: ScheduleService;

  constructor(
    taskService?: TaskService,
    _timeBlockService?: TimeBlockService,
    scheduleService?: ScheduleService
  ) {
    super();
    this.taskService = taskService ?? new TaskService();
    this.scheduleService = scheduleService ?? new ScheduleService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const taskId = args.taskId as string | undefined;
      const title = args.title as string;
      const startTime = args.start_time as string;
      const endTime = args.end_time as string;
      const duration = (args.estimated_duration_minutes ?? args.duration) as
        | number
        | undefined;
      const category = args.category as string | undefined;
      // V3.8+: 补记模式传入 "done"，创建历史已完成记录
      const initialStatus = args.initialStatus as "scheduled" | "done" | undefined;

      if (!startTime || !endTime) {
        return this.failure("缺少开始或结束时间");
      }

      if (taskId) {
        const task = await this.taskService.getTaskById(taskId);
        if (!task) return this.failure("任务不存在");

        const block = await this.scheduleService.scheduleTaskToTimeBlock({
          taskId,
          title: title || task.title,
          startTime,
          endTime,
          initialStatus,
        });
        return this.success(
          `已将任务「${task.title}」安排到时间轴`,
          block
        );
      }

      // No existing task - create task then schedule (with compensating rollback)
      const newTask = await this.taskService.createTask({
        title,
        estimated_duration_minutes: duration,
        category,
      });
      try {
        const block = await this.scheduleService.scheduleTaskToTimeBlock({
          taskId: newTask.id,
          title,
          startTime,
          endTime,
          initialStatus,
        });
        return this.success(
          `已创建任务「${title}」并安排到时间轴`,
          { task: newTask, timeBlock: block }
        );
      } catch (scheduleErr) {
        // 安排时间块失败，回滚刚创建的任务以避免孤儿数据
        try {
          await this.taskService.deleteTask(newTask.id);
        } catch {
          // 回滚失败只记录，不覆盖原始错误
        }
        return this.failure(`安排时间块失败，已回滚任务创建：${String(scheduleErr)}`);
      }
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
