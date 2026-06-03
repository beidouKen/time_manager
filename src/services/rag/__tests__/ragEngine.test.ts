// ============================================================
// ragEngine.test.ts — V3.8.6 RagEngine 统一入口
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { DeterministicEmbeddingProvider } from "@/services/rag/embedding/DeterministicEmbeddingProvider";
import { DEFAULT_SELF_HOSTED_CONFIG } from "@/services/rag/engine/RagEngineConfig";
import { RagEngine } from "@/services/rag/engine/RagEngine";
import { RagIndexManager } from "@/services/rag/indexing/RagIndexManager";
import { markSuccess, newJob } from "@/services/rag/indexing/RagIndexJob";
import { RagRetrievalPipeline } from "@/services/rag/pipeline/RagRetrievalPipeline";
import { DefaultRagQueryStrategy } from "@/services/rag/query/DefaultRagQueryStrategy";
import { RagIngestionService } from "@/services/rag/RagIngestionService";
import { RagService } from "@/services/rag/RagService";
import type { HybridRetriever } from "@/services/rag/retrieval/HybridRetriever";
import { NoopReranker } from "@/services/rag/rerank/Reranker";
import { VectorRagService } from "@/services/rag/VectorRagService";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import type { VectorRagChunkHit } from "@/types/rag.types";
import ragEngineSource from "@/services/rag/engine/RagEngine.ts?raw";

function hit(id: string, docId: string): VectorRagChunkHit {
  return {
    id,
    documentId: docId,
    chunkIndex: 0,
    content: "长".repeat(700),
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    score: 0.9,
    sourceType: "seed_knowledge",
    retrieveMode: "hybrid",
    retrievalSources: ["keyword", "vector"],
  };
}

function buildTestEngine(db = buildFakeDb()) {
  const rag = new RagService(db);
  const vector = new VectorRagService(rag, undefined, db);
  const retriever: HybridRetriever = {
    retrieve: vi.fn(async () => [hit("c1", "d1")]),
  };
  const pipeline = new RagRetrievalPipeline({
    config: DEFAULT_SELF_HOSTED_CONFIG,
    queryStrategy: new DefaultRagQueryStrategy(),
    retriever,
    reranker: new NoopReranker(),
    keywordHealth: async () => ({ backend: "sqlite-fts5" }),
    vectorHealth: async () => ({ backend: "sqlite-vector-json" }),
  });
  const indexManager = new RagIndexManager({
    rag,
    vector,
    keyword: {
      search: async () => [],
      rebuildIndex: vi.fn(),
      healthCheck: async () => ({ ok: true, backend: "fts" }),
    },
  });
  const ingestion = new RagIngestionService(rag, vector);
  return new RagEngine({
    config: DEFAULT_SELF_HOSTED_CONFIG,
    rag,
    ingestion,
    embeddingProvider: new DeterministicEmbeddingProvider(),
    retriever,
    reranker: new NoopReranker(),
    queryStrategy: new DefaultRagQueryStrategy(),
    pipeline,
    indexManager,
  });
}

describe("RagEngine", () => {
  it("retrieve 返回 hits、snippets 与 diagnostics", async () => {
    const engine = buildTestEngine();
    const result = await engine.retrieve("番茄工作法", { limit: 3 });
    expect(result.hits).toHaveLength(1);
    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0].content.length).toBeLessThanOrEqual(600);
    expect(result.diagnostics.mode).toBe("self_hosted");
    expect(result.diagnostics.queryPlanReason).toBeTruthy();
  });

  it("ingest 返回 draft 文档", async () => {
    const engine = buildTestEngine();
    const doc = await engine.ingest({
      sourceType: "user_material",
      title: "测试资料",
      fullText: "内容片段",
    });
    expect(doc.status).toBe("draft");
    expect(doc.title).toBe("测试资料");
  });

  it("activateDocument 触发 refresh job", async () => {
    const db = buildFakeDb();
    const engine = buildTestEngine(db);
    const rag = new RagService(db);
    const doc = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "激活测试",
      fullText: "可检索文本",
      status: "draft",
    });
    const job = await engine.activateDocument(doc.id);
    expect(job?.type).toBe("document_refresh");
    expect(job?.status).toBe("success");
    const activated = await rag.getDocument(doc.id);
    expect(activated?.status).toBe("active");
  });

  it("healthCheck 含 keyword/vector backend", async () => {
    const engine = buildTestEngine();
    const h = await engine.healthCheck();
    expect(h.mode).toBe("self_hosted");
    expect(h.keyword.backend).toBeTruthy();
    expect(h.vector.backend).toBeTruthy();
  });

  it("源码不含写库业务服务 import", () => {
    expect(ragEngineSource).not.toMatch(/from ["']@\/.*ToolRouter/);
    expect(ragEngineSource).not.toMatch(/from ["']@\/.*TaskService/);
    expect(ragEngineSource).not.toMatch(/from ["']@\/.*TimeBlockService/);
    expect(ragEngineSource).not.toMatch(/from ["']@\/.*ScheduleService/);
  });
});

describe("RagIndexJob helpers", () => {
  it("markSuccess 填充字段", () => {
    const j = markSuccess(newJob("keyword_rebuild"), 5, "fts5");
    expect(j.status).toBe("success");
    expect(j.processed).toBe(5);
    expect(j.backend).toBe("fts5");
    expect(j.finishedAt).toBeTruthy();
  });
});
