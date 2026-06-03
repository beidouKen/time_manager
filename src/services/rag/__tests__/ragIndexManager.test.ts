// ============================================================
// ragIndexManager.test.ts — V3.8.6 RagIndexManager
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { RagIndexManager } from "@/services/rag/indexing/RagIndexManager";
import { RagService } from "@/services/rag/RagService";
import { VectorRagService } from "@/services/rag/VectorRagService";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import type { KeywordSearch } from "@/services/rag/keyword/KeywordSearch";

describe("RagIndexManager", () => {
  it("rebuildAll 同时跑 keyword + vector", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = new VectorRagService(rag, undefined, db);
    const keyword: KeywordSearch = {
      rebuildIndex: vi.fn(async () => undefined),
      healthCheck: async () => ({ ok: true, backend: "sqlite-fts5" }),
      search: async () => [],
    };
    const mgr = new RagIndexManager({ rag, vector, keyword });
    const jobs = await mgr.rebuildAll();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.type)).toEqual(["keyword_rebuild", "vector_rebuild"]);
    expect(jobs.every((j) => j.id && j.startedAt)).toBe(true);
    expect(keyword.rebuildIndex).toHaveBeenCalled();
  });

  it("refreshDocument 调用 VectorRagService.refreshEmbeddingForDocument", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = new VectorRagService(rag, undefined, db);
    const refreshSpy = vi.spyOn(vector, "refreshEmbeddingForDocument");
    const doc = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "刷新",
      fullText: "embedding 文本",
      status: "active",
    });
    const mgr = new RagIndexManager({ rag, vector });
    const job = await mgr.refreshDocument(doc.id);
    expect(refreshSpy).toHaveBeenCalledWith(doc.id);
    expect(job.type).toBe("document_refresh");
    expect(job.status).toBe("success");
    expect(job.processed).toBe(1);
  });

  it("keyword 不可用时 backend=like-fallback 且 status=success", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = new VectorRagService(rag, undefined, db);
    const keyword: KeywordSearch = {
      rebuildIndex: vi.fn(async () => {
        throw new Error("FTS unavailable");
      }),
      healthCheck: async () => ({ ok: true, backend: "like-fallback" }),
      search: async () => [],
    };
    const mgr = new RagIndexManager({ rag, vector, keyword });
    const job = await mgr.rebuildKeywordIndex();
    expect(job.status).toBe("success");
    expect(job.backend).toBe("like-fallback");
  });

  it("getIndexStatus 返回最近 jobs", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = new VectorRagService(rag, undefined, db);
    const mgr = new RagIndexManager({ rag, vector });
    await mgr.rebuildVectorIndex();
    const status = await mgr.getIndexStatus();
    expect(status.jobs.length).toBeGreaterThanOrEqual(1);
    expect(status.jobs[0].type).toBe("vector_rebuild");
  });
});
