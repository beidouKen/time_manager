// ============================================================
// MemoryRetrieveTool — Memory 能力化预留实现（只读）
//
// 目标定位：
// - 这是后续 "Agent 主动读取用户长期偏好/行为模式/历史执行表现" 的工具入口。
// - 与 RagRetrieveTool 同级：
//   * RAG 偏向检索知识、资料、规则、用户材料、外部上下文。
//   * Memory 偏向沉淀用户长期行为、偏好、习惯、个性化时间管理策略。
//
// 当前状态：
// - 不默认注册到生产 ToolRouter。
// - 不加入 LLM prompt 工具白名单（src/agent/llm/prompts.ts）。
// - 当前 MemoryAdapter（src/agent/memory/MemoryAdapter.ts）只提供
//   recordSchedule / recordTaskCompletion / getRecentBehavior 三个面向行为
//   日志的接口，尚未对应本工具期望的 query/purpose 维度检索。
//
// 后续工具化路线（不在本阶段范围）：
// 1. 扩展 MemoryAdapter，新增 retrieveByQuery(query, purpose, windowDays, limit)
//    风格的读接口，把行为日志转译为可供 LLM 引用的 memory snippet。
// 2. 注册 MemoryRetrieveTool 到 ToolRouter。
// 3. 将 memory_retrieve 加入 prompts.ts 工具白名单。
// 4. LLM planner 支持 tool observation / replan，让 LLM 在拿到 memory snippet
//    后能继续规划 task/schedule 工具调用。
//
// 安全约束（即使未来注册，也必须遵守）：
// - 只读：禁止写任何 Service / Repository。
// - 不调用 LLM，不调用其他 Tool。
// - 检索失败时返回空 memories + 简短 summary，不抛溃。
//
// 详见 docs/V3.8/RAG_AND_MEMORY_TOOLIZATION_NOTES.md。
// ============================================================

import type { MemoryAdapter } from "@/agent/memory/MemoryAdapter";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";

/**
 * memory_retrieve 工具参数契约（未来版本对齐 LLM tool call schema）。
 */
export interface MemoryRetrieveArgs {
  /** 检索 query（自然语言），必填。 */
  query: string;
  /** 检索窗口，默认 7 天，上限 90 天。 */
  windowDays?: number;
  /** 返回 memory 数量上限，默认 3，上限 10。 */
  limit?: number;
  /**
   * 检索目的，未来用于在 adapter 内部选择不同的检索/聚合维度。
   * - preference: 用户长期偏好（如喜欢上午做写作）。
   * - behavior_pattern: 行为模式（如周三晚上 deferral 率高）。
   * - scheduling_guidance: 调度指导（如类别 X 平均估时偏差）。
   */
  purpose?: "preference" | "behavior_pattern" | "scheduling_guidance";
}

/**
 * memory_retrieve 工具返回结构。
 *
 * 注意：本阶段是占位骨架，`memories` 永远为空数组。
 * 未来真实实现需要在 MemoryAdapter 扩展后填充。
 */
export interface MemoryRetrieveResult {
  query: string;
  memories: never[];
  summary?: string;
}

export class MemoryRetrieveTool extends BaseTool {
  name = "memory_retrieve";
  description =
    "检索用户长期偏好、行为模式与历史执行表现，供 Agent 在规划时参考（只读）";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  constructor(private readonly memoryAdapter?: MemoryAdapter) {
    super();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.memoryAdapter) {
      return this.success("Memory 未启用，未返回任何记忆", {
        query: "",
        memories: [],
        summary: "memory_adapter_not_configured",
      } satisfies MemoryRetrieveResult);
    }

    const query = this.requireParam<string>(args, "query", "检索 query").trim();
    if (!query) {
      return this.failure("Memory 检索 query 不能为空");
    }

    const windowDays = this.parseWindowDays(args.windowDays);
    // limit 解析保留以验证参数契约稳定，骨架阶段不真正使用。
    void this.parseLimit(args.limit);

    // 当前 MemoryAdapter 仅暴露 getRecentBehavior(windowDays)，
    // 还无法按 query/purpose 检索。这里仅做一次 smoke read 以验证
    // adapter 可用性，不把 BehaviorRecord 当作 memory 直接返回，
    // 避免 schema 不匹配的字段泄漏到 LLM。
    try {
      await this.memoryAdapter.getRecentBehavior(windowDays);
    } catch {
      // 静默降级：adapter 异常不阻塞 tool stub。
    }

    return this.success(
      "memory_retrieve 当前为占位骨架，未返回真实 memory（等待 MemoryAdapter 扩展按 query/purpose 检索）",
      {
        query,
        memories: [],
        summary:
          "memory_retrieve_placeholder: MemoryAdapter 尚未实现按 query/purpose 检索；" +
          "未来需扩展 retrieveByQuery 接口后填充。",
      } satisfies MemoryRetrieveResult,
    );
  }

  private parseWindowDays(raw: unknown): number {
    const n = typeof raw === "number" ? raw : Number(raw ?? 7);
    if (!Number.isFinite(n)) return 7;
    return Math.max(1, Math.min(90, Math.floor(n)));
  }

  private parseLimit(raw: unknown): number {
    const n = typeof raw === "number" ? raw : Number(raw ?? 3);
    if (!Number.isFinite(n)) return 3;
    return Math.max(1, Math.min(10, Math.floor(n)));
  }
}
