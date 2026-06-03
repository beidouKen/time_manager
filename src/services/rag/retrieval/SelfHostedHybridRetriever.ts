// ============================================================
// SelfHostedHybridRetriever.ts — V3.8.5 自建 RAG 混合检索（RRF + Reranker）
// ============================================================

import type { EmbeddingProvider } from "@/services/rag/embedding/EmbeddingProvider";
import type { KeywordSearch } from "@/services/rag/keyword/KeywordSearch";
import type {
  HybridRetrieveOptions,
  HybridRetriever,
} from "@/services/rag/retrieval/HybridRetriever";
import { fuseRrf } from "@/services/rag/retrieval/rrfFusion";
import type { Reranker } from "@/services/rag/rerank/Reranker";
import { NoopReranker } from "@/services/rag/rerank/Reranker";
import type { RagService } from "@/services/rag/RagService";
import type { VectorStore } from "@/services/rag/vector/VectorStore";
import type { VectorRagChunkHit } from "@/types/rag.types";

const DEFAULT_LIMIT = 5;

export interface SelfHostedHybridRetrieverOptions {
  keyword: KeywordSearch;
  vectorStore: VectorStore;
  embeddingProvider: EmbeddingProvider;
  ragService: RagService;
  reranker?: Reranker;
  rrfK?: number;
}

export class SelfHostedHybridRetriever implements HybridRetriever {
  private readonly keyword: KeywordSearch;
  private readonly vectorStore: VectorStore;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly ragService: RagService;
  private readonly reranker: Reranker;
  private readonly rrfK: number;

  constructor(opts: SelfHostedHybridRetrieverOptions) {
    this.keyword = opts.keyword;
    this.vectorStore = opts.vectorStore;
    this.embeddingProvider = opts.embeddingProvider;
    this.ragService = opts.ragService;
    this.reranker = opts.reranker ?? new NoopReranker();
    this.rrfK = opts.rrfK ?? 60;
  }

  async retrieve(
    query: string,
    opts: HybridRetrieveOptions = {},
  ): Promise<VectorRagChunkHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const limit = opts.limit ?? DEFAULT_LIMIT;
    const searchOpts = {
      sourceTypes: opts.sourceTypes,
      limit: limit * 2,
      includeNonActive: opts.includeNonActive,
    };

    let keywordHits: VectorRagChunkHit[] = [];
    let vectorHits: VectorRagChunkHit[] = [];

    const keywordP = this.keyword.search(trimmed, searchOpts).catch(() => [] as VectorRagChunkHit[]);
    const vectorP = this.retrieveVectorHits(trimmed, searchOpts).catch(
      () => [] as VectorRagChunkHit[],
    );

    const [kw, vec] = await Promise.all([keywordP, vectorP]);
    keywordHits = kw;
    vectorHits = vec;

    if (keywordHits.length === 0 && vectorHits.length === 0) {
      return [];
    }

    const fused = fuseRrf(
      [
        { source: "keyword", hits: keywordHits },
        { source: "vector", hits: vectorHits },
      ],
      { k: this.rrfK, limit },
    );

    return this.reranker.rerank(trimmed, fused);
  }

  private async retrieveVectorHits(
    query: string,
    opts: {
      sourceTypes?: HybridRetrieveOptions["sourceTypes"];
      limit?: number;
      includeNonActive?: boolean;
    },
  ): Promise<VectorRagChunkHit[]> {
    const queryVec = await this.embeddingProvider.embed(query);
    const storeHits = await this.vectorStore.query(queryVec, {
      topK: opts.limit,
      sourceTypes: opts.sourceTypes,
      includeNonActive: opts.includeNonActive,
    });

    if (storeHits.length === 0) return [];

    const chunks = await this.ragService.getChunksWithDocByIds(
      storeHits.map((h) => h.chunkId),
      {
        sourceTypes: opts.sourceTypes,
        includeNonActive: opts.includeNonActive,
      },
    );

    const scoreById = new Map(storeHits.map((h) => [h.chunkId, h.score]));
    const hits: VectorRagChunkHit[] = [];
    for (const c of chunks) {
      const score = scoreById.get(c.id) ?? 0;
      if (score <= 0) continue;
      hits.push({
        id: c.id,
        documentId: c.documentId,
        chunkIndex: c.chunkIndex,
        content: c.content,
        tags: c.tags,
        sourceRef: c.sourceRef,
        tokenCount: c.tokenCount,
        createdAt: c.createdAt,
        score,
        sourceType: c.sourceType,
        retrieveMode: "vector",
        retrievalSources: ["vector"],
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits;
  }
}
