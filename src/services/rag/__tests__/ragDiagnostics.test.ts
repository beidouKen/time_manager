// ============================================================
// ragDiagnostics.test.ts — V3.8.6 RagDiagnostics
// ============================================================

import { describe, expect, it } from "vitest";
import { DEFAULT_LEGACY_CONFIG } from "@/services/rag/engine/RagEngineConfig";
import { RagDiagnostics } from "@/services/rag/metrics/RagDiagnostics";
import { emptyMetrics } from "@/services/rag/metrics/RagMetrics";
import type { KeywordSearch } from "@/services/rag/keyword/KeywordSearch";
import type { VectorStore } from "@/services/rag/vector/VectorStore";

describe("RagDiagnostics", () => {
  it("collectHealth 聚合 keyword/vector backend", async () => {
    const keyword: KeywordSearch = {
      search: async () => [],
      healthCheck: async () => ({ ok: true, backend: "sqlite-fts5" }),
    };
    const vectorStore: VectorStore = {
      upsert: async () => {},
      query: async () => [],
      deleteByDocument: async () => {},
      healthCheck: async () => ({ ok: true, backend: "sqlite-vector-json" }),
    };
    const diag = new RagDiagnostics({ keyword, vectorStore });
    const h = await diag.collectHealth();
    expect(h.keyword).toEqual({ ok: true, backend: "sqlite-fts5" });
    expect(h.vector).toEqual({ ok: true, backend: "sqlite-vector-json" });
  });

  it("buildPipelineDiagnostics 映射 metrics", () => {
    const diag = new RagDiagnostics({});
    const metrics = { ...emptyMetrics(), retrievalTimeMs: 12, fusedHitCount: 3, fallbackUsed: true };
    const d = diag.buildPipelineDiagnostics({
      config: DEFAULT_LEGACY_CONFIG,
      metrics,
      keywordBackend: "like",
      vectorBackend: "sqlite-vector-json",
      queryPlanReason: "user_input_with_context",
    });
    expect(d.mode).toBe("legacy");
    expect(d.retrievalTimeMs).toBe(12);
    expect(d.hitCount).toBe(3);
    expect(d.fallbackUsed).toBe(true);
    expect(d.queryPlanReason).toBe("user_input_with_context");
  });
});
