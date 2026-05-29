import type { SemanticFrame, SemanticUserGoal } from "@/agent/types";

const DEFAULT_DURATION_MINUTES = 30;

export class SemanticFrameParser {
  parse(input: string): SemanticFrame {
    const normalized = input.trim();
    const userGoal = this.detectGoal(normalized);
    const duration = this.parseDuration(normalized);
    const title = this.extractTitle(normalized, userGoal);
    const keyword = this.extractKeyword(normalized, userGoal);
    const startNow = /从现在开始|现在开始|马上开始|立即开始/.test(normalized);

    return {
      userGoal,
      objectReferences: keyword
        ? [
            {
              type: /刚刚|刚才|那个|这个|它/.test(normalized)
                ? "recent"
                : "task",
              sourceText: keyword,
              keyword,
            },
          ]
        : [],
      timeExpressions: startNow
        ? [{ sourceText: "从现在开始", normalized: "start_now" }]
        : [],
      durationExpressions: duration
        ? [{ sourceText: `${duration}分钟`, minutes: duration }]
        : [],
      constraints: {},
      userTone: "neutral",
      urgency: startNow ? "high" : "normal",
      missingInfo: [],
      confidence: userGoal === "general_chat" ? 0.5 : 0.86,
      extractedTitle: title,
      category: normalized.includes("写作") ? "writing" : undefined,
    };
  }

  private detectGoal(input: string): SemanticUserGoal {
    if (/^(你好|您好|哈喽|hello|hi)[！!。.\s]*$/i.test(input)) {
      return "greeting";
    }

    if (
      /(你是谁|你是.*谁|介绍一下你自己|你能做什么|你可以做什么)/.test(input)
    ) {
      return "ask_assistant_identity";
    }

    if (/现在.*(时候|时间|几点)|几点了|几点啊|当前时间/.test(input)) {
      return "ask_current_time";
    }

    if (
      /从现在开始|现在开始|马上开始|立即开始/.test(input) &&
      /(任务|待办|写作)/.test(input)
    ) {
      return "create_and_schedule_task";
    }

    if (/(安排在哪|排在哪|什么时候|时间段)/.test(input)) {
      return "query_schedule";
    }

    if (input.length > 0) return "unsupported_intent";
    return "general_chat";
  }

  private parseDuration(input: string): number | undefined {
    const minutes = input.match(/(?:大概|约|预计)?\s*(\d+)\s*(?:分钟|分|min)/i);
    if (minutes) return Number(minutes[1]);

    const hours = input.match(/(?:大概|约|预计)?\s*(\d+)\s*(?:小时|h)/i);
    if (hours) return Number(hours[1]) * 60;

    if (/半小时|半个小时/.test(input)) return 30;
    return undefined;
  }

  private extractTitle(
    input: string,
    userGoal: SemanticUserGoal
  ): string | undefined {
    if (userGoal !== "create_and_schedule_task") return undefined;

    if (input.includes("临时") && input.includes("写作任务")) {
      return "临时写作任务";
    }

    const taskMatch = input.match(/(?:一个|个)?(.+?任务)/);
    const rawTitle = taskMatch?.[1]
      ?.replace(/^(临时的|一个|个)/, "临时")
      .replace(/的/g, "")
      .trim();

    if (rawTitle) return rawTitle;
    return "新任务";
  }

  private extractKeyword(
    input: string,
    userGoal: SemanticUserGoal
  ): string | undefined {
    if (userGoal === "create_and_schedule_task") {
      return this.extractTitle(input, userGoal);
    }

    if (userGoal !== "query_schedule") return undefined;

    if (/刚刚|刚才|那个|这个|它/.test(input)) return "刚刚那个任务";
    if (input.includes("写作任务")) return "写作任务";

    const keywordMatch = input.match(/(.+?任务)/);
    return keywordMatch?.[1]?.trim();
  }

  getDurationOrDefault(frame: SemanticFrame): number {
    return frame.durationExpressions[0]?.minutes ?? DEFAULT_DURATION_MINUTES;
  }
}
