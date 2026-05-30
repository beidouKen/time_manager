// ============================================================
// RagAdapter.ts — 历史记忆检索接口（RAG 抽象层）
//
// V5 阶段使用 MockRagAdapter 注入固定摘要，验证 Agent 建议路径。
// 禁止接入真实向量数据库或外部 fetch。
// ============================================================

export interface RagSnippet {
  /** 摘要文本（供 Agent 生成建议时参考） */
  content: string;
  /** 相关性得分（0-1，mock 实现可固定返回） */
  relevance: number;
  /** 来源标记（仅用于调试） */
  source?: string;
}

export interface RagAdapter {
  /**
   * 根据查询词检索相关历史摘要。
   * 不调用真实 LLM 或向量数据库。
   */
  retrieveRelatedHistory(query: string): Promise<{ snippets: RagSnippet[] }>;
}
