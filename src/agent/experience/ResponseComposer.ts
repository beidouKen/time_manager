import type {
  AgentExperienceContext,
  AgentToolResult,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";
import {
  formatChineseDateTime,
  formatTimeInZone,
} from "@/agent/experience/dateFormatting";
import type { TimeBlock } from "@/types/timeblock.types";

export type ResponseKind =
  | "greeting"
  | "ask_assistant_identity"
  | "ask_current_time"
  | "general_chat"
  | "general"
  | "knowledge_no_source"
  | "writing_assist"
  | "external_info_no_tool"
  | "feedback"
  | "low_signal"
  | "meta_identity"
  | "unsupported_intent"
  | "clarification"
  | "reminder_created"
  | "tool_success"
  | "tool_failure"
  | "verification_failed"
  | "confirmation_required"
  | "confirmation_missing"
  | "confirmation_stale"
  | "confirmation_rejected";

export class ResponseComposer {
  compose(args: {
    context: AgentExperienceContext;
    frame: SemanticFrame;
    plan: ExperienceActionPlan;
    toolResults: AgentToolResult[];
    queryBlocks?: TimeBlock[];
    responseKind?: ResponseKind;
  }): string {
    const { context, frame, plan, toolResults, queryBlocks } = args;
    const kind = args.responseKind ?? this.inferResponseKind(frame, toolResults);

    switch (kind) {
      case "greeting":
        return "你好！我可以帮你记录任务、安排时间、查询日程，也可以根据你的反馈调整计划。";
      case "ask_assistant_identity":
        return "我是你的时间管理助手，可以帮你创建任务、安排时间、查看今天计划、调整任务和记录完成情况。";
      case "meta_identity":
        return "我是你的时间管理助手，可以帮你创建任务、安排时间、查看今天计划，并根据你的反馈持续优化安排。";
      case "ask_current_time":
        return `现在是 ${formatChineseDateTime(context.currentDatetime, context.timezone)}。`;
      case "general_chat":
      case "general":
        return "我在这儿。你可以告诉我你现在想推进什么，我可以帮你拆成可执行的下一步。";
      case "knowledge_no_source":
        return "这个问题我可以先给你一个通用解释；如果你要严格依据最新资料，请提供来源或让我基于你给的信息继续整理。";
      case "writing_assist":
        return "可以，我能帮你写草稿、润色语气，或按你指定的风格重写。告诉我主题和目标读者就行。";
      case "external_info_no_tool":
        return "这个请求需要实时外部信息，但我当前无法直接联网查询。你可以提供数据，我来帮你分析和整理。";
      case "feedback":
        return "收到你的反馈，这对我很重要。你可以告诉我哪里不符合预期，我会按你的偏好调整。";
      case "low_signal":
        return "我还不太确定你的目标。可以补充一下你想做什么、什么时候做吗？";
      case "unsupported_intent":
        return "这个我现在还不能很好地处理。你可以让我帮你创建任务、安排时间、查询今天计划或调整已有安排。";
      case "clarification":
        return "我需要再确认一下你的意思。可以补充一下任务名称或时间吗？";
      case "tool_failure":
        return "我没能完成这个操作。你可以换一种说法，或稍后再试。";
      case "verification_failed":
        return "我执行后发现结果和你的要求不一致，所以没有把它当作成功处理。";
      case "confirmation_required":
        return `确认要删除「${plan.params.title ?? "该任务"}」吗？这个操作无法撤销。`;
      case "confirmation_missing":
        return "这条确认请求已经不存在或过期了。";
      case "confirmation_stale":
        return "这条确认请求已经处理过了。";
      case "confirmation_rejected":
        return "已取消这次操作。";
      case "reminder_created":
        return this.composeReminderCreated(context, plan);
      case "tool_success":
        return this.composeToolSuccess(context, frame, plan, queryBlocks);
    }
  }

  private inferResponseKind(
    frame: SemanticFrame,
    toolResults: AgentToolResult[]
  ): ResponseKind {
    if (
      frame.userGoal === "ask_current_time" ||
      frame.userGoal === "general_chat" ||
      frame.userGoal === "unsupported_intent"
    ) {
      return frame.userGoal;
    }

    if (frame.userGoal === "request_advice") {
      return "general_chat";
    }

    const result = toolResults[0];
    if (result && !result.success) return "tool_failure";
    return "tool_success";
  }

  private composeReminderCreated(
    context: AgentExperienceContext,
    plan: ExperienceActionPlan
  ): string {
    const start = String(plan.params.start_time ?? "");
    const title = String(plan.params.title ?? "提醒");
    if (!start) return `已为你设置提醒「${title}」。`;
    return `已为你设置提醒「${title}」，时间是 ${formatTimeInZone(start, context.timezone)}。`;
  }

  private composeToolSuccess(
    context: AgentExperienceContext,
    frame: SemanticFrame,
    plan: ExperienceActionPlan,
    queryBlocks?: TimeBlock[]
  ): string {
    // V3.8+: 时长调整成功的反馈（"更改为 X 分钟"）
    if (frame.userGoal === "update_recent_duration" || plan.params._newDurationMinutes) {
      // ActionPlanner 在无最近时间块时会返回 missingRecentBlock=true 的 direct_response
      if (plan.params.missingRecentBlock) {
        const minutes = Number(plan.params.durationMinutes);
        if (Number.isFinite(minutes) && minutes > 0) {
          return `我还不知道你想把哪个任务改成 ${minutes} 分钟。可以告诉我任务名称，或者先创建/安排一个任务。`;
        }
        return "我还没有可以调整时长的任务。可以先告诉我任务名称，或者先安排一个任务。";
      }
      const minutes = Number(plan.params._newDurationMinutes ?? plan.params.duration);
      const title = String(plan.params.title ?? "该任务");
      const end = String(plan.params.end_time ?? "");
      if (Number.isFinite(minutes) && minutes > 0 && this.isValidIso(end)) {
        return `已把「${title}」时长改成 ${minutes} 分钟，结束时间是 ${formatTimeInZone(end, context.timezone)}。`;
      }
      if (Number.isFinite(minutes) && minutes > 0) {
        return `已把「${title}」时长改成 ${minutes} 分钟。`;
      }
      return `已为你调整「${title}」的时长。`;
    }

    if (frame.userGoal === "create_and_schedule_task") {
      const start = String(plan.params.start_time ?? "");
      const end = String(plan.params.end_time ?? "");
      const duration = Number(plan.params.duration ?? plan.params.estimated_duration_minutes);
      const title = String(plan.params.title ?? frame.extractedTitle ?? "新任务");
      const startLabel = String(plan.params.start_label ?? "现在开始");

      // V3.8+: 防御缺参数情况（LLM 可能产出不带时间字段的 tool plan）。
      // 旧实现会把 Number(undefined) 渲染成 "NaN"，formatTimeInZone(undefined) 渲染成 "--:--"，
      // 表现为 "我已把'NaN' 安排到 ...，预计 NaN 分钟，时间段是 --:-- - --:--"。
      const startOk = this.isValidIso(start);
      const endOk = this.isValidIso(end);
      const durationOk = Number.isFinite(duration) && duration > 0;

      if (!startOk || !endOk) {
        // 缺时间字段：退化为不暴露 NaN/--:-- 的安全文案
        if (durationOk) {
          return `已为你创建任务「${title}」，预计 ${duration} 分钟，稍后再为它安排具体时间。`;
        }
        return `已为你创建任务「${title}」，稍后再为它安排具体时间。`;
      }

      const durationText = durationOk ? `预计 ${duration} 分钟，` : "";
      return `我已把\u2018${title}\u2019安排到${startLabel}，${durationText}时间段是 ${formatTimeInZone(start, context.timezone)} - ${formatTimeInZone(end, context.timezone)}。`;
    }

    if (frame.userGoal === "create_reminder") {
      return this.composeReminderCreated(context, plan);
    }

    if (frame.userGoal === "query_schedule") {
      const block = queryBlocks?.[0];
      if (!plan.params.taskId) {
        return "我还不知道你指的是哪个任务。可以告诉我任务名称吗？";
      }
      if (!block) {
        return "我还没有找到这个任务的时间安排。";
      }
      return `这个任务安排在 ${formatTimeInZone(block.start_time, context.timezone)} - ${formatTimeInZone(block.end_time, context.timezone)}。`;
    }

    return "已处理完成。";
  }

  /** ISO 字符串能被 Date 正确解析才视为有效，避免下游显示 "--:--" */
  private isValidIso(value: string | undefined | null): value is string {
    if (!value) return false;
    const d = new Date(value);
    return !Number.isNaN(d.getTime());
  }
}
