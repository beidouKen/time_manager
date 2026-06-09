// ============================================================
// RagRetrieveTool — RAG 工具化预留实现
//
// 目标定位：
// - 这是后续 "Agent 主动调用 RAG" 的工具入口。
// - 它把 RagAdapter.retrieveRelatedHistory(query) 包装成 ToolRouter 可执行工具。
// - 当前不默认注册到生产 ToolRouter，也不加入 LLM prompt 工具列表。
//
// 原因：
// - 现有 LLMExperiencePlanner 是单轮结构化 plan，不具备稳定的
//   tool -> observation -> replan 循环。
// - 若现在直接把 rag_retrieve 暴露给 LLM，LLM 可能只调用 RAG 后就结束，
//   无法继续基于 snippets 调 schedule/task 等工具。
//
// 后续工具化路线：
// 1. 注册 rag_retrieve 到 ToolRouter。
// 2. 将 rag_retrieve 加入 prompts.ts 工具白名单。
// 3. 引入 tool loop / replan，使 LLM 能看到 RAG observation 后继续规划。
// 4. 再逐步把 ragContext.ts 的隐式前置注入降级为 fallback 或关闭。
// ============================================================

import type { RagAdapter, RagSnippet } from "@/agent/memory/RagAdapter";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";

export interface RagRetrieveToolResult {
  query: string;
  snippets: RagSnippet[];
  snippetCount: number;
}

export class RagRetrieveTool extends BaseTool {
  name = "rag_retrieve";
  description =
    "检索本地 RAG 知识库，返回与用户目标相关的时间管理理论、用户材料或历史摘要";
  requiresConfirmation = false;
  riskLevel = "low" as const;

  constructor(private readonly ragAdapter?: RagAdapter) {
    super();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.ragAdapter) {
      return this.success("RAG 未启用，未返回知识片段", {
        query: "",
        snippets: [],
        snippetCount: 0,
      } satisfies RagRetrieveToolResult);
    }

    const query = this.requireParam<string>(args, "query", "检索 query").trim();
    const limit = this.parseLimit(args.limit);

    if (!query) {
      return this.failure("RAG 检索 query 不能为空");
    }

    const result = await this.ragAdapter.retrieveRelatedHistory(query);
    const snippets = result.snippets.slice(0, limit);

    return this.success(
      snippets.length > 0
        ? `RAG 检索命中 ${snippets.length} 条知识片段`
        : "RAG 检索未命中知识片段",
      {
        query,
        snippets,
        snippetCount: snippets.length,
      } satisfies RagRetrieveToolResult,
    );
  }

  private parseLimit(raw: unknown): number {
    const n = typeof raw === "number" ? raw : Number(raw ?? 3);
    if (!Number.isFinite(n)) return 3;
    return Math.max(1, Math.min(5, Math.floor(n)));
  }
}
