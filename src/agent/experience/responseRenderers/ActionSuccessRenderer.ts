import { formatTimeInZone } from "@/agent/experience/dateFormatting";
import { getSemanticDisplayNoun } from "@/agent/experience/semanticDisplay";
import { ResponseKinds } from "@/agent/schemas";
import type { ResponseRenderer, RendererInput, RendererOutput } from "./types";
import { ErrorRenderer } from "./ErrorRenderer";
import {
  explicitMessage,
  formatTitle,
  isValidIso,
  output,
} from "./rendererShared";

export class ActionSuccessRenderer implements ResponseRenderer {
  readonly kind = ResponseKinds.ACTION_SUCCESS;

  render(input: RendererInput): RendererOutput {
    const explicit = explicitMessage(input);
    if (explicit) return output(input, this.kind, explicit);

    const { context, frame, plan } = input;

    if (
      frame.userGoal === "update_recent_duration" ||
      plan.params._newDurationMinutes
    ) {
      if (plan.params.missingRecentBlock) {
        const minutes = Number(plan.params.durationMinutes);
        if (Number.isFinite(minutes) && minutes > 0) {
          return output(
            input,
            this.kind,
            `我还不知道你想把哪个任务改成 ${minutes} 分钟。可以告诉我任务名称，或者先创建/安排一个任务。`
          );
        }
        return output(
          input,
          this.kind,
          "我还没有可以调整时长的任务。可以先告诉我任务名称，或者先安排一个任务。"
        );
      }
      const minutes = Number(
        plan.params._newDurationMinutes ?? plan.params.duration
      );
      const title = formatTitle(plan.params.title);
      const end = plan.params.end_time;
      if (Number.isFinite(minutes) && minutes > 0 && isValidIso(end)) {
        return output(
          input,
          this.kind,
          `已把「${title}」时长改成 ${minutes} 分钟，结束时间是 ${formatTimeInZone(
            end,
            context.timezone
          )}。`
        );
      }
      if (Number.isFinite(minutes) && minutes > 0) {
        return output(
          input,
          this.kind,
          `已把「${title}」时长改成 ${minutes} 分钟。`
        );
      }
      return output(input, this.kind, `已为你调整「${title}」的时长。`);
    }

    if (frame.userGoal === "create_and_schedule_task") {
      const start = plan.params.start_time;
      const end = plan.params.end_time;
      const duration = Number(
        plan.params.duration ?? plan.params.estimated_duration_minutes
      );
      const noun = getSemanticDisplayNoun(frame.constraints);
      const rawTitle = String(
        plan.params.title ?? frame.extractedTitle ?? ""
      ).trim();
      const title = !rawTitle || rawTitle === "新任务" ? noun : rawTitle;
      const startLabel = String(plan.params.start_label ?? "现在开始");
      const durationOk = Number.isFinite(duration) && duration > 0;

      if (!isValidIso(start) || !isValidIso(end)) {
        const durationText = durationOk ? `，预计 ${duration} 分钟` : "";
        return output(
          input,
          this.kind,
          `已为你创建${noun}「${title}」${durationText}，稍后再为它安排具体时间。`
        );
      }

      const durationText = durationOk ? `预计 ${duration} 分钟，` : "";
      if (noun === "任务") {
        return output(
          input,
          this.kind,
          `我已把‘${title}’安排到${startLabel}，${durationText}时间段是 ${formatTimeInZone(
            start,
            context.timezone
          )} - ${formatTimeInZone(end, context.timezone)}。`
        );
      }
      return output(
        input,
        this.kind,
        `我已把${noun}「${title}」安排到${startLabel}，${durationText}时间段是 ${formatTimeInZone(
          start,
          context.timezone
        )} - ${formatTimeInZone(end, context.timezone)}。`
      );
    }

    if (
      frame.userGoal === "create_reminder" ||
      input.branchLabel === "reminder_created"
    ) {
      const start = plan.params.start_time;
      const title = formatTitle(plan.params.title, "提醒");
      if (!isValidIso(start)) {
        return output(input, this.kind, `已为你设置提醒「${title}」。`);
      }
      return output(
        input,
        this.kind,
        `已为你设置提醒「${title}」，时间是 ${formatTimeInZone(
          start,
          context.timezone
        )}。`
      );
    }

    const result = input.toolResults[0];
    const resultData =
      result?.data && typeof result.data === "object"
        ? (result.data as Record<string, unknown>)
        : undefined;
    const resultMessage = result?.message?.trim();
    if (
      result?.success &&
      resultMessage &&
      resultMessage.toLowerCase() !== "ok"
    ) {
      const relatedId =
        result.relatedTaskId ?? result.relatedTimeBlockId;
      const idText = relatedId ? `（记录 ID：${relatedId}）` : "";
      return output(input, this.kind, `${resultMessage}${idText}`);
    }

    if (resultData?.title || plan.params.title) {
      const title = formatTitle(plan.params.title ?? resultData?.title);
      return output(input, this.kind, `已完成「${title}」。`);
    }

    return new ErrorRenderer().render({
      ...input,
      branchLabel: "error_fallback",
    });
  }
}
