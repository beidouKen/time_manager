import type {
  AgentExperienceContext,
  ExperienceActionPlan,
  SemanticFrame,
  SinglePlanAction,
} from "@/agent/types";
import { formatDateKey } from "@/agent/experience/dateFormatting";
import type { PlannerPort } from "@/agent/experience/PlannerPort";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";

const DEFAULT_DURATION_MINUTES = 30;
const REMINDER_DEFAULT_DURATION_MINUTES = 10;

export class ActionPlanner implements PlannerPort {
  private timeBlockService: TimeBlockService;

  constructor(
    private taskService: TaskService,
    timeBlockService?: TimeBlockService
  ) {
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

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
          const timeOfDay = frame.constraints.timeOfDay;

          // ── V3.8+ Past Time Disambiguation ─────────────────────────────────
          // 用户明确说"今天"→ 不允许静默顺延；补记 → 允许历史时间；明天 → 锁定次日
          const isExplicitToday = Boolean(frame.isExplicitToday);
          const isExplicitTomorrow = frame.explicitDateAnchor === "tomorrow";
          const possibleBackfill = Boolean(frame.possibleBackfill);

          // 仅当用户明确要求"下一个/之后"等未来时段时才允许顺延；无明确日期默认不顺延
          const requestsNextOccurrence = Boolean(frame.requestsNextOccurrence);
          const allowShiftToNextDay =
            requestsNextOccurrence && !isExplicitToday && !isExplicitTomorrow;
          // 补记模式：允许推荐已过去的时间段（忽略 now 过滤）
          const allowPastTime = possibleBackfill && isExplicitToday;
          // 明天的日期偏移（交给 TimeManagementAgent 用 context.currentDatetime 算实际 date）
          const dateOffsetDays = isExplicitTomorrow ? 1 : 0;

          return {
            ...base,
            kind: "request_recommendation",
            params: {
              title,
              duration,
              category: frame.category,
              ...(timeOfDay ? { timeOfDay } : {}),
              // Past Time Disambiguation flags
              isExplicitToday,
              isExplicitTomorrow,
              possibleBackfill,
              requestsNextOccurrence,
              allowShiftToNextDay,
              allowPastTime,
              dateOffsetDays,
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

        // B9: Empty actions → direct response, no confirmation popup
        if (actions.length === 0) {
          const noMatchText = dateRange
            ? `${dateRange.sourceText ?? "指定范围"}内未找到活跃任务，无需操作`
            : "未找到可删除的活跃任务";
          return {
            ...base,
            kind: "direct_response",
            params: { currentDatetime: context.currentDatetime, noMatch: true, noMatchText },
            summary: noMatchText,
            traceLabel: "batch_delete_tasks:empty_no_confirmation",
            replayKey: `batch_delete:empty:${dateRange?.from ?? ""}`,
          };
        }

        const summaryText = dateRange
          ? `批量删除${dateRange.sourceText ?? ""}活跃任务（共 ${actions.length} 个）`
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

      // V3.8+: 调整最近时间块的时长（无需再次提任务名）
      case "update_recent_duration": {
        const minutes = this.parseDurationFromFrame(frame);
        const blockId = context.lastScheduledTimeBlockIds[0];
        const taskId =
          context.lastCreatedTaskId ?? context.lastMentionedTaskIds[0] ?? null;

        if (!minutes || minutes <= 0) {
          return {
            ...base,
            kind: "direct_response",
            params: { currentDatetime: context.currentDatetime },
            summary: "update_recent_duration:missing_duration",
            traceLabel: "update_recent_duration:missing_duration",
            replayKey: "update_recent_duration:missing_duration",
          };
        }

        if (!blockId) {
          return {
            ...base,
            kind: "direct_response",
            params: {
              currentDatetime: context.currentDatetime,
              missingRecentBlock: true,
              durationMinutes: minutes,
            },
            summary: "update_recent_duration:no_recent_block",
            traceLabel: "update_recent_duration:no_recent_block",
            replayKey: `update_recent_duration:no_block:${minutes}`,
          };
        }

        // 取出现存 block 计算 new end_time
        let block: import("@/types/timeblock.types").TimeBlock | null = null;
        try {
          block = await this.timeBlockService.getBlockById(blockId);
        } catch {
          block = null;
        }

        if (!block) {
          return {
            ...base,
            kind: "direct_response",
            params: {
              currentDatetime: context.currentDatetime,
              missingRecentBlock: true,
              durationMinutes: minutes,
            },
            summary: "update_recent_duration:block_missing",
            traceLabel: "update_recent_duration:block_missing",
            replayKey: `update_recent_duration:block_missing:${blockId}`,
          };
        }

        const newEnd = new Date(
          new Date(block.start_time).getTime() + minutes * 60 * 1000
        );

        return {
          ...base,
          kind: "tool",
          toolName: "update_time_block",
          params: {
            timeBlockId: blockId,
            end_time: newEnd.toISOString(),
            // 仅用于 composeToolSuccess / trace 阅读，不传入 ToolRouter 的核心字段
            _newDurationMinutes: minutes,
            _previousEnd: block.end_time,
            taskId: taskId ?? undefined,
            title: block.title,
          },
          summary: `将「${block.title}」时长调整为 ${minutes} 分钟`,
          refreshHints: { timeline: true },
          traceLabel: "update_recent_duration:resize",
          replayKey: `update_recent_duration:${blockId}:${minutes}`,
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

      // V4.1+: 查询任务列表（只读，直接返回）
      case "query_tasks":
        return {
          ...base,
          kind: "query_tasks",
          params: {
            currentDatetime: context.currentDatetime,
            dateRange: frame.dateRange ?? null,
          },
          summary: "列出今日任务",
          traceLabel: "query_tasks:list",
          replayKey: `query_tasks:${context.currentDatetime.slice(0, 10)}`,
        };

      // V4.1+: 时间管理建议（只读，直接返回文案）
      case "request_advice":
        return {
          ...base,
          kind: "direct_response",
          params: {
            currentDatetime: context.currentDatetime,
            adviceRequested: true,
          },
          summary: "时间管理建议",
          traceLabel: "request_advice:direct",
          replayKey: `request_advice:${context.currentDatetime.slice(0, 10)}`,
        };

      // V4.2+: 完成任务（路由到 mark_task_completed Tool）
      case "mark_task_completed": {
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
            params: { currentDatetime: context.currentDatetime, taskNotFound: true, keyword: title },
            summary: "mark_task_completed:not_found",
            traceLabel: "mark_task_completed:not_found",
            replayKey: `complete:not_found:${title}`,
          };
        }

        return {
          ...base,
          kind: "tool",
          toolName: "mark_task_completed",
          params: { taskId: resolvedTaskId, title },
          summary: `完成任务「${title}」`,
          refreshHints: { tasks: true, timeline: true },
          traceLabel: "mark_task_completed:tool",
          replayKey: `complete:${resolvedTaskId}`,
        };
      }

      // V4.2+: 查看今日日程（只读，路由到 get_today_plan Tool）
      case "query_today_schedule":
        return {
          ...base,
          kind: "tool",
          toolName: "get_today_plan",
          params: { currentDatetime: context.currentDatetime },
          summary: "查看今日日程",
          traceLabel: "query_today_schedule:get_today_plan",
          replayKey: `query_today_schedule:${context.currentDatetime.slice(0, 10)}`,
        };

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

  /**
   * V3.8+: 从 SemanticFrame.durationExpressions 取分钟数（优先），
   * 再从原文中兜底解析 "半小时/一刻钟" 等中文表达。
   */
  private parseDurationFromFrame(frame: SemanticFrame): number | undefined {
    const fromExpr = frame.durationExpressions[0]?.minutes;
    if (fromExpr && Number.isFinite(fromExpr) && fromExpr > 0) return fromExpr;
    return undefined;
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

    // Unified path: always use DeferTaskTool → TaskService.deferTask
    // This sets status=deferred + cancels future blocks (unlike the old update_task path)
    return [
      {
        toolName: "defer_task",
        params: { taskId, ...(targetTime ? { until: targetTime } : {}) },
        summary: `将「${title}」标记为延期${targetTime ? `，延期到 ${targetTime.slice(0, 10)}` : ""}`,
      },
    ];
  }
}
