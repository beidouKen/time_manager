import { getSemanticDisplayNoun } from "@/agent/experience/semanticDisplay";
import { ResponseKinds } from "@/agent/schemas";
import type { ResponseRenderer, RendererInput, RendererOutput } from "./types";
import { explicitMessage, output } from "./rendererShared";

export class ClarificationRenderer implements ResponseRenderer {
  readonly kind = ResponseKinds.CLARIFICATION;

  render(input: RendererInput): RendererOutput {
    const explicit = explicitMessage(input);
    if (explicit) return output(input, this.kind, explicit);

    if (
      input.branchLabel === "clarification_past_time" ||
      input.plan.kind === "clarification_past_time"
    ) {
      const timeLabel = String(
        input.plan.params.originalTimeLabel ??
          input.plan.params.originalTimeIso ??
          "那个时间"
      );
      const noun = getSemanticDisplayNoun(input.plan.params);
      return output(
        input,
        this.kind,
        `你说的${timeLabel}已经过去了。你想把这个${noun}改到明天同一时间，还是今天的某个未来时间？`
      );
    }

    if (input.plan.params.taskNotFound) {
      const keyword = String(input.plan.params.keyword ?? "该任务");
      return output(
        input,
        this.kind,
        `未找到任务「${keyword}」，请告诉我具体的任务名称或重新选择。`
      );
    }

    return output(
      input,
      this.kind,
      "我需要再确认一下你的意思。可以补充任务名称、时间，或选择你指的对象吗？"
    );
  }
}
