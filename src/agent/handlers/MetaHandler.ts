// ============================================================
// MetaHandler — V3.7 P1
//
// 处理 assistant_meta 域，支持子分类：
// - meta_identity: 你是谁（默认）
// - meta_model: 你用什么模型 / 你是哪个 AI
// - meta_capabilities: 你能做什么 / 你有哪些功能
// - meta_app_help: 这个应用怎么用 / 如何导入课表
// ============================================================

import type { AgentHandler } from "@/agent/handlers/AgentHandler";
import type { AgentExperienceContext, AgentHandlerResult } from "@/agent/types";

/** 子类型关键词检测 */
function detectSubtype(userInput: string): string {
  const input = userInput.toLowerCase();

  if (/(什么模型|哪个模型|用的什么ai|用的哪个|deepseek|gpt|claude|底层|接入了什么|ai模型|语言模型)/.test(input)) {
    return "meta_model";
  }
  if (/(能做什么|有什么功能|支持哪些|能力有哪些|可以做什么|哪些能力|什么能力)/.test(input)) {
    return "meta_capabilities";
  }
  if (/(怎么用|如何使用|使用说明|使用方法|教我用|怎样用|app|应用|导入|课表)/.test(input)) {
    return "meta_app_help";
  }
  return "meta_identity";
}

/** 根据运行时环境变量构造 meta_model 文案 */
function buildModelMessage(): string {
  const enabled =
    (typeof import.meta !== "undefined" &&
      (import.meta.env?.VITE_LLM_AGENT_ENABLED as string | undefined)) === "true";
  if (!enabled) {
    return "当前我以本地规则引擎运行，没有调用外部 LLM。你的所有数据均在本设备本地处理。";
  }
  const modelName =
    (typeof import.meta !== "undefined" &&
      (import.meta.env?.VITE_LLM_MODEL as string | undefined)) ||
    "DeepSeek";
  return `我接入了 ${modelName} 作为语义理解层；具体的时间管理操作（创建任务、安排时间块等）由本地规则引擎执行，你的日程数据不会发送给 LLM。`;
}

/** meta_capabilities 文案 */
function buildCapabilitiesMessage(): string {
  return `我目前可以帮你：
- 创建、查询、修改、删除任务
- 安排任务到时间块（支持自动推荐时间）
- 查询今日日程和空闲时段
- 设置提醒
- 检测日程冲突

时间管理以外的事（如写作、知识问答）我也可以聊聊，但不会主动修改你的数据。`;
}

/** meta_app_help 文案 */
function buildAppHelpMessage(): string {
  return `你可以直接用自然语言告诉我：
- "帮我创建一个写报告任务，明天下午两点，一小时"
- "今天有哪些安排？"
- "删除写报告任务"
- "帮我安排写报告 30 分钟"（我会推荐空闲时间）

主要入口：Chat（对话）、今日日程（查看/编辑时间块）、任务列表（管理任务）。`;
}

/** meta_identity 文案 */
function buildIdentityMessage(): string {
  return "我是你的时间管理助手，可以帮你创建任务、安排日程、查询时间块等。有什么我可以帮你的？";
}

export class MetaHandler implements AgentHandler {
  readonly domain = "assistant_meta" as const;

  async handle(
    userInput: string,
    _context: AgentExperienceContext
  ): Promise<AgentHandlerResult> {
    return this.handleWithSubtype(userInput, _context);
  }

  /**
   * V3.7 P1: 支持从路由器传入 subtype（来自 LLMDomainClassifier）。
   * 若未提供，降级到关键词检测。
   */
  handleWithSubtype(
    userInput: string,
    _context: AgentExperienceContext,
    subtype?: string
  ): AgentHandlerResult {
    const resolvedSubtype = subtype ?? detectSubtype(userInput);

    switch (resolvedSubtype) {
      case "meta_model":
        return {
          domain: this.domain,
          responseKind: "meta_model",
          message: buildModelMessage(),
        };
      case "meta_capabilities":
        return {
          domain: this.domain,
          responseKind: "meta_capabilities",
          message: buildCapabilitiesMessage(),
        };
      case "meta_app_help":
        return {
          domain: this.domain,
          responseKind: "meta_app_help",
          message: buildAppHelpMessage(),
        };
      default:
        return {
          domain: this.domain,
          responseKind: "meta_identity",
          message: buildIdentityMessage(),
        };
    }
  }
}
