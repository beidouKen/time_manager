// ============================================================
// HybridRetriever.ts — V3.8.4 混合检索抽象
//
// LegacyHybridRetriever 委托 V3.8.3 VectorRagService.retrieveHybrid，
// 保证与当前 Chat 主路径行为 1:1，供后续 RRF fusion 替换。
// ============================================================

import type { VectorRagService } from "@/services/rag/VectorRagService";
import type { RagSourceType, VectorRagChunkHit } from "@/types/rag.types";

export interface HybridRetrieveOptions {
  sourceTypes?: RagSourceType[];
  limit?: number;
  includeNonActive?: boolean;
}

export interface HybridRetriever {
  retrieve(
    query: string,
    opts?: HybridRetrieveOptions,
  ): Promise<VectorRagChunkHit[]>;
}

/**
 * 占位实现：直接委托 V3.8.3 hybrid（vector 优先，keyword fallback）。
 */
export class LegacyHybridRetriever implements HybridRetriever {
  constructor(private readonly vectorRag: VectorRagService) {}

  async retrieve(
    query: string,
    opts: HybridRetrieveOptions = {},
  ): Promise<VectorRagChunkHit[]> {
    return this.vectorRag.retrieveHybrid(query, {
      sourceTypes: opts.sourceTypes,
      limit: opts.limit,
      includeNonActive: opts.includeNonActive,
    });
  }
}
