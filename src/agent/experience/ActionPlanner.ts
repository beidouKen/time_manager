import type {
  AgentExperienceContext,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";
import { formatDateKey } from "@/agent/experience/dateFormatting";
import { TaskService } from "@/services/TaskService";

const DEFAULT_DURATION_MINUTES = 30;

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
      case "greeting":
      case "ask_assistant_identity":
      case "ask_current_time":
      case "unsupported_intent":
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
        const start = new Date(context.currentDatetime);
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
          },
          summary: "create and schedule task",
          refreshHints: { tasks: true, timeline: true, timelineDate },
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
    }
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
