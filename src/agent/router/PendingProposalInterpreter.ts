// ============================================================
// PendingProposalInterpreter — V3.8
//
// 路由器 Stage 2（仅当存在 recommendation 类待确认提案时介入）。
// 输入：用户自然语言 + 提案快照 → 输出结构化 RefinementDecision。
//
// 策略：LLM-first + 规则 fallback
//   1. 规则提取器先跑（同步，零延迟），记录 ruleRefinements
//   2. 若 LLM 可用，调一次 LLM（temperature 0.1，maxTokens 256）
//   3. LLM 成功且 confidence ≥ 0.6 → 用 LLM 输出
//   4. LLM 失败/低置信/解析失败 → 用规则结果
//      - ruleRefinements 非空 → refine
//      - 否则 → null（交给 Stage 3 LLMDomainClassifier）
// ============================================================

import { z } from "zod";
import type { LLMClient } from "@/agent/llm/LLMClient";
import {
  SemanticFrameParser,
  type TimeOfDayRange,
} from "@/agent/experience/SemanticFrameParser";
import type {
  PendingProposalSnapshot,
  RefinementDecision,
} from "@/agent/types";
import { REJECT_WORDS, REJECT_WORDS_STRICT } from "@/agent/router/ContextualPreRouter";
import type { WorkingMemoryPacket } from "@/agent/context/WorkingMemoryPacket";

// ─── 规则：精确确认 / 拒绝词（用于规则 fallback 兜底） ───────────────────
const CONFIRM_RE =
  /^(好|确认|可以|yes|ok|y|对|嗯|行|没问题|好的|同意|确定)[！!。.，,\s]*$/iu;
// C2/G13: 复用 ContextualPreRouter 导出的宽松+严格正则，保持同源
const REJECT_RE = (input: string) => REJECT_WORDS_STRICT.test(input) || REJECT_WORDS.test(input);

// ─── Zod Schema：LLM 输出格式 ────────────────────────────────────────────

const TimeOfDaySchema = z
  .object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
    label: z.string(),
  })
  .optional();

const RefinementDecisionSchema = z.object({
  intent: z.enum(["confirm", "reject", "refine", "topic_change"]),
  confidence: z.number().min(0).max(1),
  refinements: z
    .object({
      durationMinutes: z.number().int().positive().optional(),
      timeOfDay: TimeOfDaySchema,
      direction: z.enum(["later", "earlier"]).optional(),
      anchorTimeLocal: z.string().optional(),
      dateOffsetDays: z.number().int().optional(),
    })
    .optional(),
  reason: z.string().optional(),
});

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(proposal: PendingProposalSnapshot, timezone: string): string {
  const startLocal = new Date(proposal.start).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
    hour12: false,
  });
  const endLocal = new Date(proposal.end).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
    hour12: false,
  });

  return `你是"待确认提案细化解释器"，只判断用户对当前提案的意图，输出严格 JSON，不回答用户。

当前待确认提案：
- 任务：「${proposal.title}」
- 推荐时间：${startLocal} - ${endLocal}（${proposal.duration} 分钟）
${proposal.timeOfDayLabel ? `- 时段偏好：${proposal.timeOfDayLabel}` : ""}

将用户输入分类为以下 4 种意图之一：
- confirm：同意当前推荐（"好""确认""可以""ok"等）
- reject：拒绝并放弃（"取消""不要""算了"等）
- refine：不完全满意，想调整某些参数（时长、时段、方向、具体时间、日期）
- topic_change：和这个提案无关，是全新话题

只在 intent=refine 时填 refinements（其他情况保持空）：
{
  durationMinutes: 新时长（分钟，整数），
  timeOfDay: { startHour, endHour, label }（时段偏好，如下午=12-18），
  direction: "later" | "earlier"（在当前推荐基础上移动），
  anchorTimeLocal: "HH:MM"（用户指定的具体本地时间），
  dateOffsetDays: 0=今天 1=明天 -1=昨天
}

输出格式（纯 JSON，无 markdown，无额外文字）：
{
  "intent": "refine",
  "confidence": 0.9,
  "refinements": { "durationMinutes": 60 },
  "reason": "用户说一个小时"
}`;
}

// ─── 中文数词 → 数字映射 ──────────────────────────────────────────────────────

const CN_NUM: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/**
 * 识别时长表达式（在 SemanticFrameParser.parseDuration 基础上补充中文数词）。
 */
function parseDurationFull(input: string): number | undefined {
  // 阿拉伯数字：X分钟 / X小时 / 半小时
  const minsMatch = input.match(/(?:大概|约|预计)?\s*(\d+(?:\.\d+)?)\s*(?:分钟|分|min)/i);
  if (minsMatch) return Math.round(Number(minsMatch[1]));

  const hoursMatch = input.match(/(?:大概|约|预计)?\s*(\d+(?:\.\d+)?)\s*(?:小时|h(?:our)?s?)/i);
  if (hoursMatch) return Math.round(Number(hoursMatch[1]) * 60);

  if (/半小时|半个小时/.test(input)) return 30;

  // 中文数词：一个小时 / 两个小时 / 两小时 等
  const cnHourMatch = input.match(new RegExp(`([${Object.keys(CN_NUM).join("")}])(?:个)?小时`));
  if (cnHourMatch) {
    const n = CN_NUM[cnHourMatch[1]];
    if (n) return n * 60;
  }

  // 中文数词：一刻钟 = 15min
  if (/一刻钟|一刻/.test(input)) return 15;

  return undefined;
}

// ─── 规则提取器 ──────────────────────────────────────────────────────────────

interface RuleRefinements {
  durationMinutes?: number;
  timeOfDay?: TimeOfDayRange;
  direction?: "later" | "earlier";
  anchorTime?: { iso: string; sourceText: string };
  kind?: "duration_only" | "time_shift" | "date_shift" | "anchor";
}

function inferRefinementKind(result: RuleRefinements): RuleRefinements["kind"] | undefined {
  if (result.anchorTime) return "anchor";
  if (result.timeOfDay || result.direction) return "time_shift";
  if (result.durationMinutes !== undefined && !result.timeOfDay && !result.direction && !result.anchorTime) {
    return "duration_only";
  }
  return undefined;
}

/**
 * 若输入明显是新建提醒/任务指令（而非对当前提案的调整），
 * 应返回 topic_change，不将其中的时间解读为提案细化。
 * 典型场景："下午三点提醒我开会" —— 是新的 create_reminder，不是调整时间。
 */
const NEW_REMINDER_RE = /提醒(我|你|他|她|一下)/;

function extractRuleRefinements(input: string): RuleRefinements | null {
  // C3: 若输入包含"提醒我/你/他/她/一下"，说明这是新建提醒请求，不是提案细化
  if (NEW_REMINDER_RE.test(input)) {
    return null;
  }

  const parser = new SemanticFrameParser();
  const result: RuleRefinements = {};
  let found = false;

  // 时长（优先用支持中文数词的完整解析器）
  const duration = parseDurationFull(input);
  if (duration) {
    result.durationMinutes = duration;
    found = true;
  }

  // 时段（无具体时刻时）
  const anchor = parser.parseTimeAnchor(input);
  if (anchor) {
    result.anchorTime = { iso: anchor.iso, sourceText: anchor.sourceText };
    found = true;
  } else {
    const tod = parser.parseTimeOfDay(input);
    if (tod) {
      result.timeOfDay = tod;
      found = true;
    }
  }

  // 方向调整
  if (/再晚|晚[一点些]|晚点|再往后|推后|稍晚|更晚|后[一点些]|推迟一下/.test(input)) {
    result.direction = "later";
    found = true;
  } else if (/再早|早[一点些]|早点|再往前|提前一下|更早|前[一点些]/.test(input)) {
    result.direction = "earlier";
    found = true;
  }

  if (!found) return null;

  const kind = inferRefinementKind(result);
  if (kind) result.kind = kind;
  return result;
}

// ─── anchorTimeLocal (HH:MM 字符串) 转 ISO ──────────────────────────────────

function anchorLocalToIso(
  localHHMM: string,
  nowIso: string,
  timezone: string
): string | null {
  const match = localHHMM.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  const now = new Date(nowIso);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const [year, month, day] = [
    Number(dateParts.year),
    Number(dateParts.month) - 1,
    Number(dateParts.day),
  ];
  const roughUtc = new Date(Date.UTC(year, month, day, hour, minute, 0));

  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  })
    .formatToParts(roughUtc)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const gotH = Number(localParts.hour ?? 0);
  const gotM = Number(localParts.minute ?? 0);
  const offsetMs = ((gotH - hour) * 60 + (gotM - minute)) * 60000;
  return new Date(roughUtc.getTime() - offsetMs).toISOString();
}

// ─── C4: packet context 辅助 ─────────────────────────────────────────────────

/**
 * 从 WorkingMemoryPacket 提取会话语境摘要，
 * 提供给 PendingProposalInterpreter LLM 以更稳定的上下文锚点。
 * 只附加最近 1-2 条消息尾部，避免 prompt 过长。
 */
function buildPacketContextBlock(packet: WorkingMemoryPacket): string {
  const parts: string[] = [];

  // 最近 assistant 消息（提供话题连续性）
  const recentMsgs = packet.conversationSummary.recentMessages;
  const lastAssistant = [...recentMsgs].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) {
    const preview = lastAssistant.content.slice(0, 100);
    parts.push(`上一条助手消息：「${preview}」`);
  }

  if (parts.length === 0) return "";
  return `会话上下文：${parts.join("；")}`;
}

// ─── PendingProposalInterpreter ──────────────────────────────────────────────

export interface ProposalInterpreterContext {
  timezone?: string;
  currentDatetime?: string;
  /** C4: 可选的 WorkingMemoryPacket，用于提供稳定的会话语境 */
  packet?: WorkingMemoryPacket;
}

export class PendingProposalInterpreter {
  private readonly confidenceThreshold = 0.6;

  constructor(private readonly llmClient: LLMClient | null) {}

  /**
   * 解释用户输入相对于待确认提案的意图。
   * 返回 null 表示无法判断（交给下游继续路由）。
   */
  async interpret(
    userInput: string,
    proposal: PendingProposalSnapshot,
    ctx: ProposalInterpreterContext = {}
  ): Promise<RefinementDecision | null> {
    const input = userInput.trim();
    const timezone = ctx.timezone ?? "Asia/Shanghai";

    // ── 快速精确路径（同步，零延迟） ────────────────────────────────────────
    if (CONFIRM_RE.test(input)) {
      return { intent: "confirm", confidence: 1.0 };
    }
    if (REJECT_RE(input)) {
      return { intent: "reject", confidence: 1.0 };
    }

    // ── 规则提取器（同步） ───────────────────────────────────────────────────
    const ruleRefinements = extractRuleRefinements(input);

    // ── LLM 解释器 ──────────────────────────────────────────────────────────
    if (this.llmClient?.isAvailable()) {
      try {
        const systemPrompt = buildSystemPrompt(proposal, timezone);
        // C4: 若有 packet，在 user content 前附加稳定会话语境（最近 assistant 消息）
        const packetContext = ctx.packet
          ? buildPacketContextBlock(ctx.packet)
          : "";
        const userContent = packetContext ? `${packetContext}\n\n用户输入：${input}` : input;
        const response = await this.llmClient.chat(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          { temperature: 0.1, maxTokens: 256 }
        );

        const llmResult = this.parseAndValidate(response.content);

        if (llmResult && llmResult.confidence >= this.confidenceThreshold) {
          // 将 anchorTimeLocal (HH:MM) 转成 ISO 供 refineRecommendation 使用
          if (
            llmResult.intent === "refine" &&
            llmResult.refinements?.anchorTimeLocal
          ) {
            const iso = anchorLocalToIso(
              llmResult.refinements.anchorTimeLocal,
              ctx.currentDatetime ?? new Date().toISOString(),
              timezone
            );
            if (iso) {
              return {
                intent: "refine",
                confidence: llmResult.confidence,
                refinements: {
                  ...this.stripAnchorLocal(llmResult.refinements),
                  anchorTime: {
                    iso,
                    sourceText: llmResult.refinements.anchorTimeLocal,
                  },
                },
              };
            }
          }

          return this.toLegacyDecision(llmResult);
        }
      } catch {
        // LLM 失败 → 静默降级到规则结果
      }
    }

    // ── 规则 fallback ────────────────────────────────────────────────────────
    if (ruleRefinements) {
      const refinements: RefinementDecision["refinements"] = {};
      if (ruleRefinements.durationMinutes !== undefined)
        refinements.durationMinutes = ruleRefinements.durationMinutes;
      if (ruleRefinements.timeOfDay) refinements.timeOfDay = ruleRefinements.timeOfDay;
      if (ruleRefinements.direction) refinements.direction = ruleRefinements.direction;
      if (ruleRefinements.anchorTime) refinements.anchorTime = ruleRefinements.anchorTime;
      if (ruleRefinements.kind) refinements.kind = ruleRefinements.kind;

      return {
        intent: "refine",
        confidence: 0.75,
        refinements,
      };
    }

    // 无法判断，让流水线继续走
    return null;
  }

  private parseAndValidate(
    raw: string
  ): (z.infer<typeof RefinementDecisionSchema> & { refinements?: { anchorTimeLocal?: string } }) | null {
    const trimmed = raw.trim();
    let jsonStr: string | null = null;

    if (trimmed.startsWith("{")) {
      const end = trimmed.lastIndexOf("}");
      if (end > 0) jsonStr = trimmed.slice(0, end + 1);
    } else {
      const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (fenced) jsonStr = fenced[1];
    }

    if (!jsonStr) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return null;
    }

    const result = RefinementDecisionSchema.safeParse(parsed);
    return result.success ? result.data : null;
  }

  private stripAnchorLocal(
    r: NonNullable<z.infer<typeof RefinementDecisionSchema>["refinements"]> & {
      anchorTimeLocal?: string;
    }
  ): RefinementDecision["refinements"] {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { anchorTimeLocal, ...rest } = r;
    return rest as RefinementDecision["refinements"];
  }

  private toLegacyDecision(
    raw: z.infer<typeof RefinementDecisionSchema>
  ): RefinementDecision {
    if (raw.intent !== "refine" || !raw.refinements) {
      return { intent: raw.intent, confidence: raw.confidence };
    }
    // anchorTimeLocal 已在上层转换，这里应不存在，直接转
    const { anchorTimeLocal, ...rest } =
      raw.refinements as typeof raw.refinements & { anchorTimeLocal?: string };
    void anchorTimeLocal;
    return {
      intent: raw.intent,
      confidence: raw.confidence,
      refinements: rest as RefinementDecision["refinements"],
    };
  }
}
