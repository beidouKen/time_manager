// ============================================================
// MockRagAdapter.ts — 固定摘要 RagAdapter 实现
//
// 返回预设摘要，用于 V5 mock 验证路径。
// 不调用真实向量数据库或外部 fetch。
// ============================================================

import type { RagAdapter, RagSnippet } from "@/agent/memory/RagAdapter";

const DEFAULT_SNIPPETS: RagSnippet[] = [
  {
    content: "过去三周写作类任务平均完成率 70%，常见超时原因：低估实际所需时间。",
    relevance: 0.85,
    source: "mock:writing_pattern",
  },
  {
    content: "用户通常在上午 9-11 点完成率最高，下午 3 点后任务延期比例上升。",
    relevance: 0.75,
    source: "mock:time_pattern",
  },
];

export class MockRagAdapter implements RagAdapter {
  private snippets: RagSnippet[];

  constructor(snippets?: RagSnippet[]) {
    this.snippets = snippets ?? DEFAULT_SNIPPETS;
  }

  async retrieveRelatedHistory(_query: string): Promise<{ snippets: RagSnippet[] }> {
    return { snippets: [...this.snippets] };
  }

  /** 替换 mock 返回内容（供测试使用） */
  setSnippets(snippets: RagSnippet[]): void {
    this.snippets = snippets;
  }
}
