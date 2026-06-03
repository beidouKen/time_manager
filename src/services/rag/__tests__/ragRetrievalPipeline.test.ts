// ============================================================
// ragRetrievalPipeline.test.ts — V3.8.6 RagRetrievalPipeline
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SELF_HOSTED_CONFIG } from "@/services/rag/engine/RagEngineConfig";
import { RagRetrievalPipeline } from "@/services/rag/pipeline/RagRetrievalPipeline";
import { DefaultRagQueryStrategy } from "@/services/rag/query/DefaultRagQueryStrategy";
import type { HybridRetriever } from "@/services/rag/retrieval/HybridRetriever";
import { NoopReranker } from "@/services/rag/rerank/Reranker";
import type { Reranker } from "@/services/rag/rerank/Reranker";
import type { VectorRagChunkHit } from "@/types/rag.types";
import pipelineSource from "@/services/rag/pipeline/RagRetrievalPipeline.ts?raw";

function hit(content: string): VectorRagChunkHit {
  return {
    id: "c1",
    documentId: "d1",
    chunkIndex: 0,
    content,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    score: 0.8,
    sourceType: "seed_knowledge",
    retrieveMode: "hybrid",
    retrievalSources: ["keyword", "vector"],
  };
}

describe("RagRetrievalPipeline", () => {
  it("diagnostics 字段齐全", async () => {
    const retriever: HybridRetriever = {
      retrieve: async () => [hit("短内容")],
    };
    const pipe = new RagRetrievalPipeline({
      config: DEFAULT_SELF_HOSTED_CONFIG,
      queryStrategy: new DefaultRagQueryStrategy(),
      retriever,
      reranker: new NoopReranker(),
      keywordHealth: async () => ({ backend: "fts5" }),
      vectorHealth: async () => ({ backend: "vec" }),
    });
    const out = await pipe.run({
      context: { userInput: "番茄" },
      sourceTypes: ["seed_knowledge"],
      limit: 2,
    });
    expect(out.diagnostics.mode).toBe("self_hosted");
    expect(out.diagnostics.keywordBackend).toBe("fts5");
    expect(out.diagnostics.vectorBackend).toBe("vec");
    expect(out.diagnostics.hitCount).toBe(1);
    expect(out.diagnostics.queryPlanReason).toBeTruthy();
  });

  it("retriever 抛错时 fallbackUsed=true 且不抛", async () => {
    const retriever: HybridRetriever = {
      retrieve: async () => {
        throw new Error("retrieve failed");
      },
    };
    const pipe = new RagRetrievalPipeline({
      config: DEFAULT_SELF_HOSTED_CONFIG,
      queryStrategy: new DefaultRagQueryStrategy(),
      retriever,
      reranker: new NoopReranker(),
    });
    const out = await pipe.run({ context: { userInput: "q" } });
    expect(out.diagnostics.fallbackUsed).toBe(true);
    expect(out.hits).toHaveLength(0);
  });

  it("sourceTypes 透传给 retriever", async () => {
    const retrieve = vi.fn(async () => [] as VectorRagChunkHit[]);
    const pipe = new RagRetrievalPipeline({
      config: DEFAULT_SELF_HOSTED_CONFIG,
      queryStrategy: new DefaultRagQueryStrategy(),
      retriever: { retrieve },
      reranker: new NoopReranker(),
    });
    await pipe.run({
      context: { userInput: "test" },
      sourceTypes: ["user_material"],
      limit: 4,
    });
    expect(retrieve).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({ sourceTypes: ["user_material"], limit: 4 }),
    );
  });

  it("snippet content 长度 ≤ 600", async () => {
    const long = "x".repeat(800);
    const pipe = new RagRetrievalPipeline({
      config: DEFAULT_SELF_HOSTED_CONFIG,
      queryStrategy: new DefaultRagQueryStrategy(),
      retriever: { retrieve: async () => [hit(long)] },
      reranker: new NoopReranker(),
    });
    const out = await pipe.run({ context: { userInput: "q" } });
    expect(out.snippets[0].content.length).toBeLessThanOrEqual(600);
  });

  it("reranker 失败时 fallbackUsed 且保留预排序结果", async () => {
    const failingReranker: Reranker = {
      rerank: async () => {
        throw new Error("rerank fail");
      },
    };
    const pipe = new RagRetrievalPipeline({
      config: DEFAULT_SELF_HOSTED_CONFIG,
      queryStrategy: new DefaultRagQueryStrategy(),
      retriever: { retrieve: async () => [hit("ok")] },
      reranker: failingReranker,
    });
    const out = await pipe.run({ context: { userInput: "q" } });
    expect(out.diagnostics.fallbackUsed).toBe(true);
    expect(out.hits).toHaveLength(1);
  });

  it("源码边界：不写库服务", () => {
    expect(pipelineSource).not.toMatch(/ToolRouter/);
    expect(pipelineSource).not.toMatch(/TaskService/);
  });
});
