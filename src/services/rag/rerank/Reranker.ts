// ============================================================
// Reranker.ts — V3.8.4 重排序抽象
//
// NoopReranker 不改变候选；后续可接 cross-encoder / LLM rerank。
// Reranker 只调整排序，不得改写业务数据或触发写库。
// ============================================================

import type { VectorRagChunkHit } from "@/types/rag.types";

export interface Reranker {
  rerank(
    query: string,
    candidates: VectorRagChunkHit[],
  ): Promise<VectorRagChunkHit[]>;
}

/** 恒等重排：保持候选数量、顺序与字段不变。 */
export class NoopReranker implements Reranker {
  async rerank(
    _query: string,
    candidates: VectorRagChunkHit[],
  ): Promise<VectorRagChunkHit[]> {
    return candidates;
  }
}
