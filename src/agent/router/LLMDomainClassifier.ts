// ============================================================
// LLMDomainClassifier — V3.7 P1
//
// 三段式路由器第二段：LLM 语义分类器。
//
// 安全约束（绝对不可破坏）：
// 1. 仅分类，不回答用户
// 2. 不调用任何 ToolRouter / Tool
// 3. 不访问任何 Service / Repository
// 4. 不执行任何写操作
// 5. LLM 返回非法 JSON / 低置信度 / 写边界违规 → 返回 null，由 Fallback 处理
// ============================================================

import { z } from "zod";
import type { LLMClient } from "@/agent/llm/LLMClient";
import type { AgentDomain, DomainRoutingDecision } from "@/agent/types";
import type { WorkingMemoryPacket } from "@/agent/context/WorkingMemoryPacket";

// ─── 合法 domain 白名单 ──────────────────────────────────────────────────────

const VALID_DOMAINS: AgentDomain[] = [
  "time_management",
  "assistant_meta",
  "general_chat",
  "knowledge_qa",
  "writing_assistant",
  "external_info",
  "feedback_or_complaint",
  "low_signal",
];

// ─── Zod Schema ──────────────────────────────────────────────────────────────

const DomainRoutingDecisionSchema = z.object({
  domain: z.enum([
    "time_management",
    "assistant_meta",
    "general_chat",
    "knowledge_qa",
    "writing_assistant",
    "external_info",
    "feedback_or_complaint",
    "low_signal",
  ]),
  subtype: z.string().optional(),
  confidence: z.number().min(0).max(1),
  requiresWrite: z.boolean(),
  reason: z.string(),
});

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `你是一个对话意图分类器，输出严格的 JSON，不能回答用户，不能执行任何操作。

将用户输入分类到以下 8 个域之一：

- time_management：涉及创建/查询/删除/安排任务、时间块、提醒、日程等。requiresWrite=true 时表示需要写操作。
- assistant_meta：询问助手自身信息，如"你是谁""你用什么模型""这个应用怎么用""你能做什么"。subtype 可为 meta_identity / meta_model / meta_capabilities / meta_app_help。
- general_chat：日常闲聊、问候、情绪表达等。
- knowledge_qa：询问客观知识、概念解释、方法论等（非实时信息）。
- writing_assistant：写作、润色、翻译、文案等。
- external_info：需要实时外部信息，如天气、新闻、股价、汇率等。
- feedback_or_complaint：对应用的反馈、投诉、建议。
- low_signal：内容无法理解、噪声、无意义输入。

输出格式（JSON 对象，无其他文字）：
{
  "domain": "域名",
  "subtype": "可选子类型",
  "confidence": 0.85,
  "requiresWrite": false,
  "reason": "分类原因简述"
}

重要规则：
1. 只输出纯 JSON，无 markdown，无解释。
2. requiresWrite 为 true 时，domain 必须是 time_management。
3. 若 domain 不是 time_management，requiresWrite 必须为 false。`;
}

// ─── Context Summary ─────────────────────────────────────────────────────────

export interface ClassifierContext {
  pendingConfirmationId?: string;
  pendingClarification?: boolean;
  lastAssistantText?: string;
  timezone?: string;
}

function buildContextSummary(ctx: ClassifierContext): string {
  const parts: string[] = [];
  if (ctx.pendingConfirmationId) {
    parts.push(`当前有待确认操作（ID: ${ctx.pendingConfirmationId}）`);
  }
  if (ctx.pendingClarification) {
    parts.push("用户正在补充澄清信息");
  }
  if (ctx.lastAssistantText) {
    parts.push(`上一条助手消息：「${ctx.lastAssistantText.slice(0, 80)}」`);
  }
  return parts.length > 0 ? `上下文：${parts.join("；")}` : "";
}

/**
 * C4: 从 WorkingMemoryPacket 构建分类器上下文字符串，
 * 使用 active_context_summary 和 pending_confirmation_summary 替代 buildContextSummary 的朴素实现。
 */
function buildContextSummaryFromPacket(
  packet: WorkingMemoryPacket,
  ctx: ClassifierContext
): string {
  const parts: string[] = [];
  const ac = packet.activeContextSummary;

  if (ac.status === "pending_confirmation" && ac.confirmationId) {
    const desc = packet.pendingConfirmationSummary
      ? `（${packet.pendingConfirmationSummary.actionType}，风险：${packet.pendingConfirmationSummary.riskLevel}）`
      : "";
    parts.push(`当前有待确认操作${desc}（ID: ${ac.confirmationId}）`);
  } else if (ac.status === "pending_proposal" && ac.confirmationId) {
    const title = ac.proposal?.title ? `「${ac.proposal.title}」` : "";
    parts.push(`当前有待确认推荐方案${title}（ID: ${ac.confirmationId}）`);
  } else if (ctx.pendingConfirmationId) {
    parts.push(`当前有待确认操作（ID: ${ctx.pendingConfirmationId}）`);
  }

  if (ctx.pendingClarification) {
    parts.push("用户正在补充澄清信息");
  }

  // 取 packet 最后一条 assistant 消息（已去软删，更可靠）
  const recentMsgs = packet.conversationSummary.recentMessages;
  const lastAssistant = [...recentMsgs].reverse().find((m) => m.role === "assistant");
  const assistantText = lastAssistant?.content ?? ctx.lastAssistantText;
  if (assistantText) {
    parts.push(`上一条助手消息：「${assistantText.slice(0, 80)}」`);
  }

  return parts.length > 0 ? `上下文：${parts.join("；")}` : "";
}

// ─── LLMDomainClassifier ─────────────────────────────────────────────────────

export class LLMDomainClassifier {
  private readonly confidenceThreshold: number;

  constructor(
    private client: LLMClient,
    options: { confidenceThreshold?: number } = {}
  ) {
    this.confidenceThreshold = options.confidenceThreshold ?? 0.55;
  }

  isAvailable(): boolean {
    return this.client.isAvailable();
  }

  /**
   * 调用 LLM 分类域，返回 DomainRoutingDecision 或 null（需要 fallback）。
   * C4: 可传入 WorkingMemoryPacket，使用 active_context_summary 替代 buildContextSummary。
   */
  async classify(
    userInput: string,
    context: ClassifierContext = {},
    packet?: WorkingMemoryPacket
  ): Promise<DomainRoutingDecision | null> {
    if (!this.client.isAvailable()) return null;

    // C4: 优先用 packet 提供的 active_context_summary 和 pending_confirmation_summary
    const contextSummary = packet
      ? buildContextSummaryFromPacket(packet, context)
      : buildContextSummary(context);
    const userContent = contextSummary
      ? `${contextSummary}\n\n用户输入：${userInput}`
      : `用户输入：${userInput}`;

    // 让 LLMError / 网络错误向上抛出，由 DomainRoutingService 标记为 llm_error。
    // 只有 JSON 解析 / schema 校验失败才在内部返回 null。
    const response = await this.client.chat(
      [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: userContent },
      ],
      { temperature: 0.1, maxTokens: 256 }
    );

    return this.parseAndValidate(response.content);
  }

  private parseAndValidate(raw: string): DomainRoutingDecision | null {
    // 1. 提取 JSON（LLM 可能包裹在 ```json ... ``` 中）
    const jsonStr = this.extractJson(raw);
    if (!jsonStr) return null;

    // 2. 解析 JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return null;
    }

    // 3. Zod schema 校验
    const result = DomainRoutingDecisionSchema.safeParse(parsed);
    if (!result.success) return null;

    const decision = result.data as DomainRoutingDecision;

    // 4. domain 白名单
    if (!VALID_DOMAINS.includes(decision.domain)) return null;

    // 5. 写边界校验：requiresWrite=true 且 domain !== time_management → 非法
    if (decision.requiresWrite && decision.domain !== "time_management") return null;

    // 6. 置信度阈值
    if (decision.confidence < this.confidenceThreshold) return null;

    return decision;
  }

  private extractJson(text: string): string | null {
    const trimmed = text.trim();

    // 直接是 JSON 对象
    if (trimmed.startsWith("{")) {
      const end = trimmed.lastIndexOf("}");
      if (end > 0) return trimmed.slice(0, end + 1);
    }

    // 包裹在 ```json ... ```
    const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenced) return fenced[1];

    return null;
  }
}
