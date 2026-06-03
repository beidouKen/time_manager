// ============================================================
// selfHostedHybridRetriever.test.ts — V3.8.5 RRF Hybrid + Reranker
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { DeterministicEmbeddingProvider } from "@/services/rag/embedding/DeterministicEmbeddingProvider";
import type { KeywordSearch } from "@/services/rag/keyword/KeywordSearch";
import { fuseRrf } from "@/services/rag/retrieval/rrfFusion";
import { SelfHostedHybridRetriever } from "@/services/rag/retrieval/SelfHostedHybridRetriever";
import { RagService } from "@/services/rag/RagService";
import type { Reranker } from "@/services/rag/rerank/Reranker";
import type { VectorStore } from "@/services/rag/vector/VectorStore";
import type { VectorRagChunkHit } from "@/types/rag.types";
import selfHostedSource from "@/services/rag/retrieval/SelfHostedHybridRetriever.ts?raw";

function hit(
  id: string,
  score: number,
  mode: "vector" | "keyword",
): VectorRagChunkHit {
  return {
    id,
    documentId: `doc-${id}`,
    chunkIndex: 0,
    content: `content-${id}`,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    score,
    sourceType: "seed_knowledge",
    retrieveMode: mode,
    retrievalSources: [mode],
  };
}

describe("fuseRrf", () => {
  it("同 chunk 去重并标记 hybrid", () => {
    const fused = fuseRrf(
      [
        { source: "vector", hits: [hit("c1", 0.9, "vector")] },
        { source: "keyword", hits: [hit("c1", 0.8, "keyword")] },
      ],
      { k: 60, limit: 5 },
    );
    expect(fused).toHaveLength(1);
    expect(fused[0].retrieveMode).toBe("hybrid");
    expect(fused[0].retrievalSources).toContain("vector");
    expect(fused[0].retrievalSources).toContain("keyword");
  });

  it("RRF 排序稳定", () => {
    const fused = fuseRrf(
      [
        { source: "vector", hits: [hit("b", 1, "vector"), hit("a", 0.5, "vector")] },
        { source: "keyword", hits: [hit("b", 1, "keyword"), hit("c", 0.5, "keyword")] },
      ],
      { k: 60, limit: 5 },
    );
    expect(fused[0].id).toBe("b");
    expect(fused[0].score).toBeGreaterThan(fused.find((x) => x.id === "a")?.score ?? 0);
  });
});

describe("SelfHostedHybridRetriever", () => {
  it("同时融合 vector 和 keyword", async () => {
    const keyword: KeywordSearch = {
      search: async () => [hit("k1", 0.7, "keyword")],
    };
    const vectorStore: VectorStore = {
      upsert: async () => {},
      query: async () => [
        { chunkId: "v1", documentId: "doc-v1", score: 0.8 },
      ],
      deleteByDocument: async () => {},
      healthCheck: async () => ({ ok: true, backend: "stub" }),
    };
    const rag = {
      getChunksWithDocByIds: async () => [
        {
          id: "v1",
          documentId: "doc-v1",
          chunkIndex: 0,
          content: "vector chunk",
          tags: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          sourceType: "seed_knowledge" as const,
        },
      ],
    } as unknown as RagService;

    const provider = new DeterministicEmbeddingProvider();
    const retriever = new SelfHostedHybridRetriever({
      keyword,
      vectorStore,
      embeddingProvider: provider,
      ragService: rag,
    });

    const results = await retriever.retrieve("q", {
      sourceTypes: ["seed_knowledge"],
      limit: 5,
    });
    expect(results.length).toBe(2);
    const ids = new Set(results.map((r) => r.id));
    expect(ids.has("k1")).toBe(true);
    expect(ids.has("v1")).toBe(true);
  });

  it("limit 控制返回数量", async () => {
    const keyword: KeywordSearch = {
      search: async () =>
        ["a", "b", "c"].map((id) => hit(id, 0.5, "keyword")),
    };
    const vectorStore: VectorStore = {
      upsert: async () => {},
      query: async () => [],
      deleteByDocument: async () => {},
      healthCheck: async () => ({ ok: true, backend: "stub" }),
    };
    const retriever = new SelfHostedHybridRetriever({
      keyword,
      vectorStore,
      embeddingProvider: new DeterministicEmbeddingProvider(),
      ragService: { getChunksWithDocByIds: async () => [] } as unknown as RagService,
    });

    const results = await retriever.retrieve("q", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("NoopReranker 被调用", async () => {
    const rerankSpy = vi.fn(async (_q: string, c: VectorRagChunkHit[]) => c);
    const reranker: Reranker = { rerank: rerankSpy };
    const keyword: KeywordSearch = {
      search: async () => [hit("x", 0.9, "keyword")],
    };
    const vectorStore: VectorStore = {
      upsert: async () => {},
      query: async () => [],
      deleteByDocument: async () => {},
      healthCheck: async () => ({ ok: true, backend: "stub" }),
    };
    const retriever = new SelfHostedHybridRetriever({
      keyword,
      vectorStore,
      embeddingProvider: new DeterministicEmbeddingProvider(),
      ragService: { getChunksWithDocByIds: async () => [] } as unknown as RagService,
      reranker,
    });

    await retriever.retrieve("test");
    expect(rerankSpy).toHaveBeenCalledOnce();
  });

  it("sourceTypes 透传 keyword 与 vectorStore", async () => {
    const kwSearch = vi.fn(async () => [] as VectorRagChunkHit[]);
    const vsQuery = vi.fn(async () => []);
    const keyword: KeywordSearch = { search: kwSearch };
    const vectorStore: VectorStore = {
      upsert: async () => {},
      query: vsQuery,
      deleteByDocument: async () => {},
      healthCheck: async () => ({ ok: true, backend: "stub" }),
    };
    const retriever = new SelfHostedHybridRetriever({
      keyword,
      vectorStore,
      embeddingProvider: new DeterministicEmbeddingProvider(),
      ragService: { getChunksWithDocByIds: async () => [] } as unknown as RagService,
    });

    await retriever.retrieve("q", { sourceTypes: ["user_material"], limit: 3 });
    expect(kwSearch).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({ sourceTypes: ["user_material"] }),
    );
    expect(vsQuery).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ sourceTypes: ["user_material"], topK: 6 }),
    );
  });
});

describe("V3.8.5 安全边界", () => {
  it("SelfHostedHybridRetriever 不 import 写库服务", () => {
    expect(selfHostedSource).not.toMatch(/from ["']@\/.*ToolRouter/);
    expect(selfHostedSource).not.toMatch(/from ["']@\/.*TaskService/);
    expect(selfHostedSource).not.toMatch(/from ["']@\/.*TimeBlockService/);
    expect(selfHostedSource).not.toMatch(/from ["']@\/.*ScheduleService/);
  });
});
