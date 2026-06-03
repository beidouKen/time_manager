// ============================================================
// RagDiagnostics.ts — V3.8.6 健康检查与管线诊断聚合
// ============================================================

import type { RagEngineConfig } from "@/services/rag/engine/RagEngineConfig";
import type { KeywordSearch } from "@/services/rag/keyword/KeywordSearch";
import type { RagPipelineDiagnostics } from "@/services/rag/pipeline/RagPipelineTypes";
import type { RagRetrievalMetrics } from "@/services/rag/metrics/RagMetrics";
import type { VectorStore } from "@/services/rag/vector/VectorStore";

export interface RagBackendHealth {
  keyword: { ok: boolean; backend: string };
  vector: { ok: boolean; backend: string };
}

export class RagDiagnostics {
  constructor(
    private readonly deps: {
      keyword?: KeywordSearch;
      vectorStore?: VectorStore;
    },
  ) {}

  async collectHealth(): Promise<RagBackendHealth> {
    let keyword = { ok: true, backend: "unavailable" };
    let vector = { ok: true, backend: "unavailable" };

    if (this.deps.keyword?.healthCheck) {
      try {
        const h = await this.deps.keyword.healthCheck();
        keyword = { ok: h.ok, backend: h.backend };
      } catch {
        keyword = { ok: false, backend: "error" };
      }
    }

    if (this.deps.vectorStore?.healthCheck) {
      try {
        const h = await this.deps.vectorStore.healthCheck();
        vector = { ok: h.ok, backend: h.backend };
      } catch {
        vector = { ok: false, backend: "error" };
      }
    }

    return { keyword, vector };
  }

  buildPipelineDiagnostics(input: {
    config: RagEngineConfig;
    metrics: RagRetrievalMetrics;
    keywordBackend: string;
    vectorBackend: string;
    queryPlanReason: string;
  }): RagPipelineDiagnostics {
    return {
      mode: input.config.mode,
      keywordBackend: input.keywordBackend,
      vectorBackend: input.vectorBackend,
      retrievalTimeMs: input.metrics.retrievalTimeMs,
      rerankTimeMs: input.metrics.rerankTimeMs,
      hitCount: input.metrics.fusedHitCount,
      keywordHitCount: input.metrics.keywordHitCount,
      vectorHitCount: input.metrics.vectorHitCount,
      fusedHitCount: input.metrics.fusedHitCount,
      fallbackUsed: input.metrics.fallbackUsed,
      queryPlanReason: input.queryPlanReason,
    };
  }
}
