import type {
  AgentExperienceContext,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";
import { formatDateKey } from "@/agent/experience/dateFormatting";
import { TaskService } from "@/services/TaskService";

const DEFAULT_DURATION_MINUTES = 30;
const REMINDER_DEFAULT_DURATION_MINUTES = 10;

export class ActionPlanner {
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
          return {
            ...base,
            kind: "request_recommendation",
            params: {
              title: frame.extractedTitle ?? "新任务",
              duration,
              category: frame.category,
            },
            summary: "request recommendation",
          };
        }

        const start = new Date(
          absoluteStart?.iso ?? context.currentDatetime
        );
        const end = new Date(start.getTime() + duration * 60 * 1000);
        const timelineDate = formatDateKey(start);

        return {
          ...base,
          kind: "tool",
          toolName: "schedule_task",
          params: {
            title: frame.extractedTitle ?? "新任务",
            category: frame.category,
            duration,
            estimated_duration_minutes: duration,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            start_label: absoluteStart?.sourceText ?? "现在开始",
          },
          summary: "create and schedule task",
          refreshHints: { tasks: true, timeline: true, timelineDate },
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
        };
      }

      default:
        return {
          ...base,
          kind: "direct_response",
          params: { currentDatetime: context.currentDatetime },
          summary: "general_chat",
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
