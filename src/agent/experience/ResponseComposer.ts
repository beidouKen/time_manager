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
  | "unsupported_intent"
  | "clarification"
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
      case "ask_current_time":
        return `现在是 ${formatChineseDateTime(context.currentDatetime, context.timezone)}。`;
      case "general_chat":
      case "unsupported_intent":
        return "这个我现在还不能很好地处理。你可以让我帮你创建任务、安排时间、查询今天计划或调整已有安排。";
      case "clarification":
        return "我需要再确认一下你的意思。可以补充一下任务名称或时间吗？";
      case "tool_failure":
        return "我没能完成这个操作。你可以换一种说法，或稍后再试。";
      case "verification_failed":
        return "我执行后发现结果和你的要求不一致，所以没有把它当作成功处理。";
      case "confirmation_required":
        return "这个操作需要你确认后我再执行。";
      case "confirmation_missing":
        return "这条确认请求已经不存在或过期了。";
      case "confirmation_stale":
        return "这条确认请求已经处理过了。";
      case "confirmation_rejected":
        return "已取消这次操作。";
      case "tool_success":
        return this.composeToolSuccess(context, frame, plan, queryBlocks);
    }
  }

  private inferResponseKind(
    frame: SemanticFrame,
    toolResults: AgentToolResult[]
  ): ResponseKind {
    if (
      frame.userGoal === "greeting" ||
      frame.userGoal === "ask_assistant_identity" ||
      frame.userGoal === "ask_current_time" ||
      frame.userGoal === "general_chat" ||
      frame.userGoal === "unsupported_intent"
    ) {
      return frame.userGoal;
    }

    const result = toolResults[0];
    if (result && !result.success) return "tool_failure";
    return "tool_success";
  }

  private composeToolSuccess(
    context: AgentExperienceContext,
    frame: SemanticFrame,
    plan: ExperienceActionPlan,
    queryBlocks?: TimeBlock[]
  ): string {
    if (frame.userGoal === "create_and_schedule_task") {
      const start = String(plan.params.start_time);
      const end = String(plan.params.end_time);
      const duration = Number(plan.params.duration);
      const title = String(plan.params.title);
      return `我已把‘${title}’安排到现在开始，预计 ${duration} 分钟，时间段是 ${formatTimeInZone(start, context.timezone)} - ${formatTimeInZone(end, context.timezone)}。`;
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
}
