// ============================================================
// ragIndexManagerEnhanced.test.ts — V3.8.7
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { RagIndexManager } from "@/services/rag/indexing/RagIndexManager";
import { RagService } from "@/services/rag/RagService";
import { VectorRagService } from "@/services/rag/VectorRagService";
import type { VectorStore } from "@/services/rag/vector/VectorStore";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import type { KeywordSearch } from "@/services/rag/keyword/KeywordSearch";

describe("RagIndexManager V3.8.7 enhanced", () => {
  it("rebuildVectorIndex 含 total/skipped/durationMs", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = new VectorRagService(rag, undefined, db);
    vi.spyOn(vector, "embedMissingChunks").mockResolvedValue({ embedded: 2, total: 5 });
    const mgr = new RagIndexManager({ rag, vector });
    const job = await mgr.rebuildVectorIndex();
    expect(job.status).toBe("success");
    expect(job.processed).toBe(2);
    expect(job.total).toBe(5);
    expect(job.skipped).toBe(3);
    expect(job.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("keyword 失败仍 success + like-fallback + warnings", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = new VectorRagService(rag, undefined, db);
    const keyword: KeywordSearch = {
      search: async () => [],
      rebuildIndex: vi.fn(async () => {
        throw new Error("FTS down");
      }),
      healthCheck: async () => ({ ok: true, backend: "like-fallback" }),
    };
    const mgr = new RagIndexManager({ rag, vector, keyword });
    const job = await mgr.rebuildKeywordIndex();
    expect(job.status).toBe("success");
    expect(job.backend).toBe("like-fallback");
    expect(job.warnings?.length).toBeGreaterThan(0);
  });

  it("clearVectorIndex 调用 vectorStore.clearModel", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = new VectorRagService(rag, undefined, db);
    const vectorStore: VectorStore = {
      upsert: async () => {},
      query: async () => [],
      deleteByDocument: async () => {},
      healthCheck: async () => ({ ok: true, backend: "stub" }),
      clearModel: vi.fn(async () => 7),
    };
    const mgr = new RagIndexManager({ rag, vector, vectorStore });
    const job = await mgr.clearVectorIndex("m1", "v1");
    expect(vectorStore.clearModel).toHaveBeenCalledWith("m1", "v1");
    expect(job.type).toBe("vector_clear");
    expect(job.processed).toBe(7);
  });

  it("reindexForEmbeddingModelChange 串行 clear + rebuild", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = new VectorRagService(rag, undefined, db);
    const vectorStore: VectorStore = {
      upsert: async () => {},
      query: async () => [],
      deleteByDocument: async () => {},
      healthCheck: async () => ({ ok: true, backend: "stub" }),
      clearModel: async () => 1,
    };
    vi.spyOn(vector, "embedMissingChunks").mockResolvedValue({ embedded: 0, total: 0 });
    const mgr = new RagIndexManager({ rag, vector, vectorStore });
    const jobs = await mgr.reindexForEmbeddingModelChange("old", "v0", "new", "v1");
    expect(jobs).toHaveLength(2);
    expect(jobs[0].type).toBe("vector_clear");
    expect(jobs[1].type).toBe("vector_rebuild");
  });
});
