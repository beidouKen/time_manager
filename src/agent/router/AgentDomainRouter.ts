import type { AgentDomain, AgentRouteResult } from "@/agent/types";

const LOW_SIGNAL_PATTERN = /^[\s\p{P}\p{S}]*$/u;

export class AgentDomainRouter {
  classify(rawInput: string): AgentRouteResult {
    const input = rawInput.trim();
    const domain = this.detectDomain(input);

    return {
      domain,
      confidence: this.getConfidence(domain, input),
      matchedRule: domain,
      rawInput,
    };
  }

  private detectDomain(input: string): AgentDomain {
    if (!input || input.length <= 1 || LOW_SIGNAL_PATTERN.test(input)) {
      return "low_signal";
    }

    if (/(你是谁|你是.*谁|你能做什么|你可以做什么|介绍一下你自己)/.test(input)) {
      return "assistant_meta";
    }

    if (/(天气|新闻|汇率|股价|实时|最新消息)/.test(input)) {
      return "external_info";
    }

    if (
      /(现在.*(时候|时间|几点)|几点了|几点啊|当前时间|任务|安排|日程|时间块|待办)/.test(
        input
      )
    ) {
      return "time_management";
    }

    if (/(太慢|没用|不对|不好用|投诉|反馈|问题很多)/.test(input)) {
      return "feedback_or_complaint";
    }

    if (/(帮我写|写一|润色|改写|翻译|文案|诗)/.test(input)) {
      return "writing_assistant";
    }

    if (/(什么是|为什么|如何|解释一下|科普)/.test(input)) {
      return "knowledge_qa";
    }

    return "general_chat";
  }

  private getConfidence(domain: AgentDomain, input: string): number {
    if (!input) return 0.2;
    if (domain === "general_chat") return 0.55;
    if (domain === "low_signal") return 0.9;
    return 0.82;
  }
}
