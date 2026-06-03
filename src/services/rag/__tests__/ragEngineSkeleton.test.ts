// ============================================================
// ragEngineSkeleton.test.ts — V3.8.4 RAG Engine 接口骨架测试
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { LegacyHybridRetriever } from "@/services/rag/retrieval/HybridRetriever";
import { NoopReranker } from "@/services/rag/rerank/Reranker";
import type { VectorStore } from "@/services/rag/vector/VectorStore";
import type { VectorRagService } from "@/services/rag/VectorRagService";
import type { VectorRagChunkHit } from "@/types/rag.types";
import vectorStoreSource from "@/services/rag/vector/VectorStore.ts?raw";
import hybridRetrieverSource from "@/services/rag/retrieval/HybridRetriever.ts?raw";
import rerankerSource from "@/services/rag/rerank/Reranker.ts?raw";

const sampleHit: VectorRagChunkHit = {
  id: "chunk-1",
  documentId: "doc-1",
  chunkIndex: 0,
  content: "番茄工作法",
  tags: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  score: 0.9,
  sourceType: "seed_knowledge",
  retrieveMode: "vector",
};

describe("NoopReranker", () => {
  it("不改变候选数量、顺序与字段", async () => {
    const reranker = new NoopReranker();
    const candidates = [sampleHit, { ...sampleHit, id: "chunk-2", score: 0.5 }];
    const out = await reranker.rerank("番茄", candidates);
    expect(out).toEqual(candidates);
    expect(out).toHaveLength(2);
    expect(out[0].retrieveMode).toBe("vector");
    expect(out[0].sourceType).toBe("seed_knowledge");
  });
});

describe("LegacyHybridRetriever", () => {
  it("转发 query 与 opts 到 VectorRagService.retrieveHybrid", async () => {
    const retrieveHybrid = vi.fn().mockResolvedValue([sampleHit]);
    const mockVector = { retrieveHybrid } as unknown as VectorRagService;
    const retriever = new LegacyHybridRetriever(mockVector);

    const hits = await retriever.retrieve("番茄", {
      sourceTypes: ["seed_knowledge"],
      limit: 2,
    });

    expect(retrieveHybrid).toHaveBeenCalledWith("番茄", {
      sourceTypes: ["seed_knowledge"],
      limit: 2,
    });
    expect(hits).toEqual([sampleHit]);
  });

  it("保留 sourceTypes 过滤参数", async () => {
    const retrieveHybrid = vi.fn().mockResolvedValue([]);
    const mockVector = { retrieveHybrid } as unknown as VectorRagService;
    const retriever = new LegacyHybridRetriever(mockVector);

    await retriever.retrieve("q", { sourceTypes: ["user_material"] });

    expect(retrieveHybrid).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({ sourceTypes: ["user_material"] }),
    );
  });
});

describe("VectorStore 接口形状", () => {
  it("导出 VectorStore 类型供后续 adapter 实现", () => {
    const stub: VectorStore = {
      async upsert() {},
      async query() {
        return [];
      },
      async deleteByDocument() {},
      async healthCheck() {
        return { ok: true, backend: "stub" };
      },
    };
    expect(stub.healthCheck).toBeDefined();
    expect(stub.query).toBeDefined();
  });
});

describe("V3.8.4 安全边界静态扫描", () => {
  const sources = [
    { name: "VectorStore", raw: vectorStoreSource },
    { name: "HybridRetriever", raw: hybridRetrieverSource },
    { name: "Reranker", raw: rerankerSource },
  ];

  for (const { name, raw } of sources) {
    it(`${name} 不 import 写库服务`, () => {
      expect(raw).not.toMatch(/from ["']@\/.*ToolRouter/);
      expect(raw).not.toMatch(/from ["']@\/.*TaskService/);
      expect(raw).not.toMatch(/from ["']@\/.*TimeBlockService/);
      expect(raw).not.toMatch(/from ["']@\/.*ScheduleService/);
      expect(raw).not.toMatch(/from ["']@\/store\/chatStore/);
    });
  }
});
