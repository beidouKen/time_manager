// ============================================================
// sanitizeRecommendation.ts — V3.8 RAG 建议文本安全清洗
//
// 职责：在把 RAG / RecommendationHandler 产生的建议注脚追加到用户
// 可见回复之前，去除可能暴露内部实现细节或模拟命令口吻的内容。
//
// 设计原则：
// - 复用 ResponseBoundary 已有的内部名称正则（不重复维护）。
// - 额外过滤 JSON 指令和命令口吻段落（RAG 外部内容可能包含）。
// - 纯函数，无副作用，便于单测。
// - 若清洗后内容为空，返回空字符串（调用方应跳过追加）。
// ============================================================

/** 与 ResponseBoundary 保持同步的内部实现名正则。 */
const INTERNAL_NAME_PATTERN =
  /\b(userGoal|processWith|ToolRouter|LLMPlanner|ActionPlanner|SemanticFrameParser|AgentDomainRouter|semantic_frame|request_recommendation|tool_success|tool_failure|confirmation_required|delete_task|create_reminder|create_and_schedule_task|query_schedule|ask_current_time|unsupported_intent|general_chat)\b/gi;

/** 匹配看起来像工具调用 / JSON 结构的片段（松散检测）。 */
const JSON_LIKE_PATTERN = /(\{[^}]{0,300}\}|\[[^\]]{0,300}\])/g;

/** 匹配命令口吻的段落开头（"请执行"、"立即"、"你必须" 等）。 */
const COMMAND_TONE_PATTERN = /^(请执行|立即执行|你必须|请立即|execute|run\s+tool)/im;

/**
 * 清洗 RAG/Recommendation 建议文本，确保安全后才追加到用户可见回复。
 *
 * 清洗步骤：
 * 1. 去掉内部实现名（ToolRouter、toolName 等）。
 * 2. 去掉 JSON/数组结构片段。
 * 3. 若整段含有命令口吻（"请执行"、"立即执行"等），整段丢弃，返回空串。
 * 4. 压缩多余空白。
 *
 * @returns 清洗后文本，或空字符串（调用方应视为"无建议"跳过追加）。
 */
export function sanitizeRecommendation(text: string): string {
  if (!text || !text.trim()) return "";

  // 3. 命令口吻整段丢弃
  if (COMMAND_TONE_PATTERN.test(text)) return "";

  let result = text;

  // 1. 去掉内部实现名
  result = result.replace(INTERNAL_NAME_PATTERN, "");

  // 2. 去掉 JSON-like 片段
  result = result.replace(JSON_LIKE_PATTERN, "");

  // 压缩多余空白
  result = result.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return result;
}
