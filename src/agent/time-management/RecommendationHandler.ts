/**
 * RecommendationHandler.ts — V5 建议型 Agent 处理器
 *
 * 基于 MockMemoryAdapter（历史完成情况）和 MockRagAdapter（历史知识摘要）
 * 生成时间管理建议。
 *
 * 设计原则：
 *   - 建议响应分类为 "suggestion" / "confirmation_required" / "executable_action"
 *   - suggestion = 只读建议，不写库，不发通知
 *   - confirmation_required = 需要用户确认才执行
 *   - executable_action = 已经被确认或安全自动执行
 *   - 不绕过 ConfirmationService
 */

import type { MemoryAdapter } from "@/agent/memory/MemoryAdapter";
import type { RagAdapter } from "@/agent/memory/RagAdapter";
import type { NotificationAdapter } from "@/agent/notification/NotificationAdapter";
import type { AgentExperienceContext } from "@/agent/types";

export type ScheduleDensity = "low" | "medium" | "high" | "overload";

export interface ScheduleDensityResult {
  density: ScheduleDensity;
  blockCount: number;
  totalMinutes: number;
  suggestion: string;
  overloadThresholdMinutes: number;
}

export interface RecommendationResult {
  suggestionKind: "suggestion" | "confirmation_required" | "executable_action";
  message: string;
  /** 当 suggestionKind=confirmation_required 时存在 */
  proposedAction?: {
    description: string;
    toolName: string;
    params: Record<string, unknown>;
  };
  /** suggestion 时不写库、不发通知 */
  shouldNotify: boolean;
}

interface RecommendationHandlerDeps {
  memoryAdapter?: MemoryAdapter;
  ragAdapter?: RagAdapter;
  notificationAdapter?: NotificationAdapter;
}

const OVERLOAD_THRESHOLD_MINUTES = 8 * 60; // 8 hours
const HIGH_THRESHOLD_MINUTES = 6 * 60; // 6 hours
const MEDIUM_THRESHOLD_MINUTES = 3 * 60; // 3 hours
const OVERLOAD_BLOCK_COUNT = 8;

export class RecommendationHandler {
  constructor(private deps: RecommendationHandlerDeps) {}

  /**
   * 基于历史数据和当前日程生成建议。
   *
   * @param ragQuery 可选语义化查询词，用于 RAG 检索。
   *   调用方应优先传入用户输入 + 当前任务标题等语义信息；
   *   不传时退回到基于 todayBlocks 标题的最小 query。
   *   不要传 currentDatetime 等无语义值。
   */
  async generateRecommendation(
    context: AgentExperienceContext,
    todayBlocks: Array<{ title: string; start_time: string; end_time: string }>,
    ragQuery?: string,
  ): Promise<RecommendationResult> {
    const density = this.detectScheduleDensity(todayBlocks);
    // 构建最终 query：优先使用调用方提供的语义 query，
    // 退回到 todayBlocks 标题拼接，最后兜底为空字符串。
    const resolvedQuery =
      ragQuery?.trim() ||
      todayBlocks.map((b) => b.title).filter(Boolean).join(" ") ||
      "";
    const historyInsights = await this.fetchHistoryInsights(context, resolvedQuery);

    // Overload detection: too many blocks or too long
    if (density.density === "overload") {
      return {
        suggestionKind: "confirmation_required",
        message:
          `你今天的计划已经相当满了（${density.blockCount} 个安排，共 ${Math.round(density.totalMinutes / 60)} 小时）。${density.suggestion}` +
          (historyInsights ? `\n\n${historyInsights}` : ""),
        proposedAction: {
          description: `压缩今天的计划，移除 ${density.blockCount - 5} 个任务`,
          toolName: "batch_action",
          params: { action: "reduce_overload", targetBlockCount: 5 },
        },
        shouldNotify: false,
      };
    }

    // History-based suggestion (purely informational)
    if (historyInsights) {
      return {
        suggestionKind: "suggestion",
        message: historyInsights,
        shouldNotify: false,
      };
    }

    // Default light suggestion
    if (density.density === "high") {
      return {
        suggestionKind: "suggestion",
        message: `今天安排较满（${density.blockCount} 个任务，共 ${Math.round(density.totalMinutes / 60)} 小时），建议保留 15-30 分钟缓冲时间。`,
        shouldNotify: false,
      };
    }

    return {
      suggestionKind: "executable_action",
      message: "今天的计划安排合理，节奏良好。",
      shouldNotify: false,
    };
  }

  /**
   * 检测日程密度。
   * 纯粹基于传入的 blocks，不访问真实数据库。
   */
  detectScheduleDensity(
    blocks: Array<{ title: string; start_time: string; end_time: string }>
  ): ScheduleDensityResult {
    const totalMinutes = blocks.reduce((acc, b) => {
      const start = new Date(b.start_time).getTime();
      const end = new Date(b.end_time).getTime();
      return acc + Math.max(0, (end - start) / 60000);
    }, 0);

    const blockCount = blocks.length;
    let density: ScheduleDensity;
    let suggestion: string;

    if (blockCount >= OVERLOAD_BLOCK_COUNT || totalMinutes >= OVERLOAD_THRESHOLD_MINUTES) {
      density = "overload";
      suggestion = "建议移除低优先级任务或将部分任务延期。";
    } else if (totalMinutes >= HIGH_THRESHOLD_MINUTES) {
      density = "high";
      suggestion = "建议适当减少任务密度，保留缓冲时间。";
    } else if (totalMinutes >= MEDIUM_THRESHOLD_MINUTES) {
      density = "medium";
      suggestion = "计划密度适中。";
    } else {
      density = "low";
      suggestion = "计划有余裕，可以增加任务。";
    }

    return {
      density,
      blockCount,
      totalMinutes,
      suggestion,
      overloadThresholdMinutes: OVERLOAD_THRESHOLD_MINUTES,
    };
  }

  /**
   * 从 Memory 和 RAG adapter 汇聚洞察文本。
   *
   * @param _context 当前 agent 上下文（保留参数，供未来扩展使用）。
   * @param ragQuery 语义化查询词；不应使用 currentDatetime 等无语义值。
   */
  private async fetchHistoryInsights(
    _context: AgentExperienceContext,
    ragQuery: string,
  ): Promise<string> {
    const parts: string[] = [];

    // From memory adapter
    if (this.deps.memoryAdapter) {
      const behavior = await this.deps.memoryAdapter.getRecentBehavior(21);
      const categories = Object.keys(behavior.completionRateByCategory);
      for (const cat of categories) {
        const rate = behavior.completionRateByCategory[cat] ?? 1;
        if (rate < 0.7) {
          parts.push(
            `根据最近记录，你的${cat}类任务完成率约 ${Math.round(rate * 100)}%，` +
            `建议为${cat}任务多预留 10 分钟缓冲时间。`
          );
          break; // only one insight at a time
        }
      }
    }

    // From RAG adapter — 使用语义化 query 而非 currentDatetime。
    // 若 query 为空字符串，RagService.retrieve 会因 tokenize 得到空数组而直接返回 []。
    if (this.deps.ragAdapter && ragQuery) {
      const { snippets } = await this.deps.ragAdapter.retrieveRelatedHistory(ragQuery);
      for (const snippet of snippets.slice(0, 1)) {
        if (snippet.content) {
          parts.push(snippet.content);
        }
      }
    }

    return parts.join("\n\n");
  }
}
