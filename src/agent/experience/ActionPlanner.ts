import type {
  AgentExperienceContext,
  ExperienceActionPlan,
  SemanticFrame,
  SinglePlanAction,
} from "@/agent/types";
import { formatDateKey } from "@/agent/experience/dateFormatting";
import type { PlannerExtras, PlannerPort } from "@/agent/experience/PlannerPort";
import { TaskService } from "@/services/TaskService";

const DEFAULT_DURATION_MINUTES = 30;
const REMINDER_DEFAULT_DURATION_MINUTES = 10;

export class ActionPlanner implements PlannerPort {
  constructor(private taskService: TaskService) {}

  async plan(
    frame: SemanticFrame,
    context: AgentExperienceContext,
    _extras?: PlannerExtras
  ): Promise<ExperienceActionPlan> {
    const base = {
      id: crypto.randomUUID(),
      userGoal: frame.userGoal,
      requiresConfirmation: false,
      riskLevel: "safe" as const,
      createdAt: new Date().toISOString(),
    };

    switch (frame.userGoal) {
      case "ask_current_time":
      case "general_chat":
        return {
          ...base,
          kind: "direct_response",
          params: { currentDatetime: context.currentDatetime },
          summary: frame.userGoal,
          traceLabel: `${frame.userGoal}:direct`,
          replayKey: `direct:${frame.userGoal}`,
        };

      case "create_and_schedule_task": {
        const duration =
          frame.durationExpressions[0]?.minutes ?? DEFAULT_DURATION_MINUTES;
        const hasStartNow = frame.timeExpressions.some(
          (expr) => expr.normalized === "start_now"
        );
        const absoluteStart = frame.timeExpressions.find(
          (expr) => expr.normalized === "absolute" && expr.iso
        );

        if (!hasStartNow && !absoluteStart) {
          const title = frame.extractedTitle ?? "新任务";
          const timeOfDay = frame.constraints.timeOfDay;
          return {
            ...base,
            kind: "request_recommendation",
            params: {
              title,
              duration,
              category: frame.category,
              ...(timeOfDay ? { timeOfDay } : {}),
            },
            summary: "request recommendation",
            traceLabel: "create_and_schedule_task:fuzzy_recommendation",
            replayKey: `recommendation:${title}:${duration}`,
          };
        }

        const start = new Date(
          absoluteStart?.iso ?? context.currentDatetime
        );
        const end = new Date(start.getTime() + duration * 60 * 1000);
        const timelineDate = formatDateKey(start);
        const title = frame.extractedTitle ?? "新任务";
        const scheduleKind = absoluteStart ? "absolute" : "start_now";

        return {
          ...base,
          kind: "tool",
          toolName: "schedule_task",
          params: {
            title,
            category: frame.category,
            duration,
            estimated_duration_minutes: duration,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            start_label: absoluteStart?.sourceText ?? "现在开始",
          },
          summary: "create and schedule task",
          refreshHints: { tasks: true, timeline: true, timelineDate },
          traceLabel: `create_and_schedule_task:${scheduleKind}`,
          replayKey: `schedule:${title}:${start.toISOString().slice(0, 16)}:${duration}`,
        };
      }

      case "create_reminder": {
        const anchorExpr = frame.timeExpressions.find(
          (e) => e.normalized === "absolute" && e.iso
        );
        const startTime = anchorExpr?.iso ?? context.currentDatetime;
        const duration =
          frame.durationExpressions[0]?.minutes ?? REMINDER_DEFAULT_DURATION_MINUTES;
        const end = new Date(
          new Date(startTime).getTime() + duration * 60 * 1000
        );
        const timelineDate = formatDateKey(new Date(startTime));
        const title = frame.extractedTitle ?? "提醒";

        return {
          ...base,
          kind: "tool",
          toolName: "create_time_block",
          params: {
            title,
            type: "event",
            start_time: startTime,
            end_time: end.toISOString(),
            source: "system",
          },
          summary: "create reminder",
          refreshHints: { timeline: true, timelineDate },
          traceLabel: "create_reminder:tool",
          replayKey: `reminder:${title}:${startTime.slice(0, 16)}`,
        };
      }

      case "delete_task": {
        const taskId =
          context.lastCreatedTaskId ?? context.lastMentionedTaskIds[0] ?? null;
        const keyword = frame.objectReferences[0]?.keyword;
        const resolvedTaskId =
          taskId ?? (await this.findTaskIdByKeyword(keyword));
        const title = frame.extractedTitle ?? keyword ?? "该任务";

        if (!resolvedTaskId) {
          return {
            ...base,
            kind: "direct_response",
            params: { currentDatetime: context.currentDatetime },
            summary: "delete_task_not_found",
            traceLabel: "delete_task:not_found",
            replayKey: `delete:not_found:${title}`,
          };
        }

        return {
          ...base,
          kind: "tool",
          toolName: "delete_task",
          requiresConfirmation: true,
          riskLevel: "destructive",
          params: { taskId: resolvedTaskId, title },
          summary: `删除任务「${title}」`,
          refreshHints: { tasks: true, timeline: true },
          traceLabel: "delete_task:confirmation_required",
          replayKey: `delete:${resolvedTaskId}`,
        };
      }

      case "query_schedule": {
        const taskId =
          context.lastCreatedTaskId ?? context.lastMentionedTaskIds[0] ?? null;
        const resolvedTaskId =
          taskId ??
          (await this.findSingleTaskId(frame.objectReferences[0]?.keyword));

        return {
          ...base,
          kind: "query_schedule",
          params: {
            taskId: resolvedTaskId,
            keyword: frame.objectReferences[0]?.keyword,
          },
          summary: "query scheduled time",
          traceLabel: "query_schedule:lookup",
          replayKey: `query:${resolvedTaskId ?? "unknown"}`,
        };
      }

      // V4+: 多日查询（只读）
      case "query_schedule_range": {
        const { dateRange } = frame;
        return {
          ...base,
          kind: "query_schedule",
          params: {
            dateRange: dateRange ?? null,
            keyword: frame.objectReferences[0]?.keyword,
          },
          summary: `查询 ${dateRange?.sourceText ?? "多日"} 计划`,
          traceLabel: "query_schedule_range:multi_day",
          replayKey: `query_range:${dateRange?.from ?? ""}:${dateRange?.to ?? ""}`,
        };
      }

      // V4+: 批量删除（高风险，必须确认）— V3.7 预先分解 actions[]
      case "batch_delete_tasks": {
        const { dateRange } = frame;
        const actions = await this.buildBatchDeleteActions(dateRange);
        // dateRange 已提供但匹配为空 → 返回空 actions[] 并提示无需操作
        const summaryText = dateRange
          ? actions.length === 0
            ? `${dateRange.sourceText ?? ""}范围内未找到活跃任务`
            : `批量删除${dateRange.sourceText ?? ""}活跃任务（共 ${actions.length} 个）`
          : `批量删除全部活跃任务（共 ${actions.length} 个）`;
        return {
          ...base,
          kind: "batch_action",
          requiresConfirmation: true,
          riskLevel: "destructive",
          params: {
            dateRange: dateRange ?? null,
            actions,
          },
          summary: summaryText,
          refreshHints: { tasks: true, timeline: true },
          traceLabel: "batch_delete_tasks:confirmation_required",
          replayKey: `batch_delete:${dateRange?.from ?? ""}:${dateRange?.to ?? ""}`,
        };
      }

      // V4+: 批量重排（高风险）— V3.7 预先分解 actions[]
      case "batch_reschedule_day": {
        const { dateRange } = frame;
        const actions = this.buildBatchRescheduleActions(dateRange);
        return {
          ...base,
          kind: "batch_action",
          requiresConfirmation: true,
          riskLevel: "destructive",
          params: { dateRange: dateRange ?? null, actions },
          summary: `重排${dateRange?.sourceText ?? "今天"}计划`,
          refreshHints: { tasks: true, timeline: true },
          traceLabel: "batch_reschedule_day:confirmation_required",
          replayKey: `batch_reschedule:${dateRange?.from ?? ""}`,
        };
      }

      // V4+: 延期任务（建议，不直接改原计划）— V3.7 预先分解 actions[]
      case "defer_task": {
        const title = frame.extractedTitle ?? frame.objectReferences[0]?.keyword ?? "该任务";
        const taskId = context.lastCreatedTaskId ?? context.lastMentionedTaskIds[0] ?? null;
        const targetAnchor = frame.timeExpressions.find(e => e.normalized === "absolute");
        const actions = this.buildDeferActions(taskId, title, targetAnchor?.iso ?? null);
        return {
          ...base,
          kind: "defer_task",
          requiresConfirmation: true,
          riskLevel: "confirm",
          params: {
            taskId,
            title,
            targetTime: targetAnchor?.iso ?? null,
            targetSourceText: targetAnchor?.sourceText ?? null,
            actions,
          },
          summary: `建议延期「${title}」`,
          refreshHints: { tasks: true, timeline: true },
          traceLabel: "defer_task:suggestion",
          replayKey: `defer:${taskId ?? title}`,
        };
      }

      default:
        return {
          ...base,
          kind: "direct_response",
          params: { currentDatetime: context.currentDatetime },
          summary: "general_chat",
          traceLabel: `${frame.userGoal}:fallback`,
          replayKey: `fallback:${frame.userGoal}`,
        };
    }
  }

  private async findTaskIdByKeyword(
    keyword: string | undefined
  ): Promise<string | null> {
    return this.findSingleTaskId(keyword);
  }

  private async findSingleTaskId(
    keyword: string | undefined
  ): Promise<string | null> {
    if (!keyword) return null;

    const tasks = await this.taskService.getTasks({ excludeDeleted: true });
    const matches = tasks.filter(
      (task) =>
        task.title.includes(keyword) ||
        keyword.includes(task.title) ||
        keyword.replace(/任务$/, "").includes(task.title.replace(/任务$/, ""))
    );

    return matches.length === 1 ? matches[0].id : null;
  }

  // ─── V3.7 辅助：预先分解 batch/defer 为 actions[] ────────────────────────

  private async buildBatchDeleteActions(
    dateRange: SemanticFrame["dateRange"]
  ): Promise<SinglePlanAction[]> {
    try {
      const allTasks = await this.taskService.getTasks({ excludeDeleted: true });
      const activeTasks = allTasks.filter((t) => t.status !== "done" && t.status !== "cancelled");

      if (!dateRange) {
        return activeTasks.map((t) => ({
          toolName: "delete_task",
          params: { taskId: t.id, title: t.title },
          summary: `删除任务「${t.title}」`,
        }));
      }

      const from = new Date(dateRange.from + "T00:00:00");
      const to = new Date(dateRange.to + "T23:59:59");

      const inRange = activeTasks.filter((t) => {
        if (!t.deadline) return false;
        const d = new Date(t.deadline);
        return d >= from && d <= to;
      });

      // dateRange 提供但无匹配 → 返回空数组，不扩大作用域
      if (inRange.length === 0) {
        return [];
      }

      return inRange.map((t) => ({
        toolName: "delete_task",
        params: { taskId: t.id, title: t.title },
        summary: `删除任务「${t.title}」`,
      }));
    } catch {
      return [];
    }
  }

  private buildBatchRescheduleActions(
    dateRange: SemanticFrame["dateRange"]
  ): SinglePlanAction[] {
    const dateKey = dateRange?.from ?? formatDateKey(new Date());
    const sourceText = dateRange?.sourceText ?? "今天";
    return [
      {
        toolName: "reschedule_day",
        params: { date: dateKey },
        summary: `重排${sourceText}的时间块`,
      },
    ];
  }

  private buildDeferActions(
    taskId: string | null,
    title: string,
    targetTime: string | null
  ): SinglePlanAction[] {
    if (!taskId) return [];

    if (targetTime) {
      return [
        {
          toolName: "update_task",
          params: { taskId, deadline: targetTime },
          summary: `将「${title}」截止时间更新为 ${targetTime.slice(0, 10)}`,
        },
      ];
    }

    return [
      {
        toolName: "update_task",
        params: { taskId, status: "todo" },
        summary: `将「${title}」标记为待办（稍后安排）`,
      },
    ];
  }
}
