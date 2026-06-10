import { formatChineseDateTime } from "@/agent/experience/dateFormatting";
import { ResponseKinds } from "@/agent/schemas";
import type { ResponseRenderer, RendererInput, RendererOutput } from "./types";
import { explicitMessage, output } from "./rendererShared";

export class SuggestionRenderer implements ResponseRenderer {
  readonly kind = ResponseKinds.SUGGESTION;

  render(input: RendererInput): RendererOutput {
    const explicit = explicitMessage(input);
    if (explicit) return output(input, this.kind, explicit);

    const messages: Record<string, string> = {
      greeting:
        "你好！我可以帮你记录任务、安排时间、查询日程，也可以根据你的反馈调整计划。",
      ask_assistant_identity:
        "我是你的时间管理助手，可以帮你创建任务、安排时间、查看今天计划、调整任务和记录完成情况。",
      meta_identity:
        "我是你的时间管理助手，可以帮你创建任务、安排时间、查看今天计划，并根据你的反馈持续优化安排。",
      general_chat:
        "我在这儿。你可以告诉我你现在想推进什么，我可以帮你拆成可执行的下一步。",
      general:
        "我在这儿。你可以告诉我你现在想推进什么，我可以帮你拆成可执行的下一步。",
      knowledge_no_source:
        "这个问题我可以先给你一个通用解释；如果你要严格依据最新资料，请提供来源或让我基于你给的信息继续整理。",
      writing_assist:
        "可以，我能帮你写草稿、润色语气，或按你指定的风格重写。告诉我主题和目标读者就行。",
      feedback:
        "收到你的反馈，这对我很重要。你可以告诉我哪里不符合预期，我会按你的偏好调整。",
      low_signal: "我还不太确定你的目标。可以补充一下你想做什么、什么时候做吗？",
      unsupported_intent:
        "这个我现在还不能很好地处理。你可以让我帮你创建任务、安排时间、查询今天计划或调整已有安排。",
    };

    if (input.branchLabel === "ask_current_time") {
      return output(
        input,
        this.kind,
        `现在是 ${formatChineseDateTime(
          input.context.currentDatetime,
          input.context.timezone
        )}。`
      );
    }

    return output(
      input,
      this.kind,
      messages[input.branchLabel ?? "general"] ?? messages.general
    );
  }
}
