import type {
  AgentExperienceContext,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";
import { formatDateKey } from "@/agent/experience/dateFormatting";
import type { PlannerPort } from "@/agent/experience/PlannerPort";
import { TaskService } from "@/services/TaskService";

const DEFAULT_DURATION_MINUTES = 30;
const REMINDER_DEFAULT_DURATION_MINUTES = 10;

export class ActionPlanner implements PlannerPort {
  constructor(private taskService: TaskService) {}

  async plan(
    frame: SemanticFrame,
    context: AgentExperienceContext
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
          return {
            ...base,
            kind: "request_recommendation",
            params: {
              title,
              duration,
              category: frame.category,
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

      // V4+: 批量删除（高风险，必须确认）
      case "batch_delete_tasks": {
        const { dateRange } = frame;
        return {
          ...base,
          kind: "batch_action",
          requiresConfirmation: true,
          riskLevel: "destructive",
          params: {
            dateRange: dateRange ?? null,
            batchActions: [] as Array<{ toolName: string; args: Record<string, unknown> }>,
          },
          summary: `批量删除${dateRange?.sourceText ?? ""}任务`,
          refreshHints: { tasks: true, timeline: true },
          traceLabel: "batch_delete_tasks:confirmation_required",
          replayKey: `batch_delete:${dateRange?.from ?? ""}:${dateRange?.to ?? ""}`,
        };
      }

      // V4+: 批量重排（高风险）
      case "batch_reschedule_day": {
        const { dateRange } = frame;
        return {
          ...base,
          kind: "batch_action",
          requiresConfirmation: true,
          riskLevel: "destructive",
          params: { dateRange: dateRange ?? null },
          summary: `重排${dateRange?.sourceText ?? ""}计划`,
          refreshHints: { tasks: true, timeline: true },
          traceLabel: "batch_reschedule_day:confirmation_required",
          replayKey: `batch_reschedule:${dateRange?.from ?? ""}`,
        };
      }

      // V4+: 延期任务（建议，不直接改原计划）
      case "defer_task": {
        const title = frame.extractedTitle ?? frame.objectReferences[0]?.keyword ?? "该任务";
        const taskId = context.lastCreatedTaskId ?? context.lastMentionedTaskIds[0] ?? null;
        const targetAnchor = frame.timeExpressions.find(e => e.normalized === "absolute");
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
}
