// ============================================================
// sqliteVectorStore.test.ts — V3.8.5 SqliteVectorStore
// ============================================================

import { describe, expect, it } from "vitest";
import { DeterministicEmbeddingProvider } from "@/services/rag/embedding/DeterministicEmbeddingProvider";
import { RagService } from "@/services/rag/RagService";
import { SqliteVectorStore } from "@/services/rag/vector/SqliteVectorStore";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";

describe("SqliteVectorStore", () => {
  const provider = new DeterministicEmbeddingProvider();

  it("upsert 后 query 可返回命中", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const store = new SqliteVectorStore(provider, db);

    const doc = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "向量",
      fullText: "番茄工作法 专注",
      status: "active",
    });
    const chunks = await rag.listChunksForDocument(doc.id);
    const vec = await provider.embed(chunks[0].content);

    await store.upsert([
      {
        chunkId: chunks[0].id,
        documentId: doc.id,
        embeddingModel: provider.model,
        embeddingVersion: provider.version,
        vector: vec,
        dimensions: vec.length,
      },
    ]);

    const qVec = await provider.embed("番茄");
    const hits = await store.query(qVec, { sourceTypes: ["seed_knowledge"], topK: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunkId).toBe(chunks[0].id);
  });

  it("sourceTypes 过滤生效", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const store = new SqliteVectorStore(provider, db);

    const d1 = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "A",
      fullText: "专注块",
      status: "active",
    });
    const d2 = await rag.ingestDocument({
      sourceType: "user_material",
      title: "B",
      fullText: "专注块",
      status: "active",
    });
    for (const d of [d1, d2]) {
      const ch = (await rag.listChunksForDocument(d.id))[0];
      const v = await provider.embed(ch.content);
      await store.upsert([
        {
          chunkId: ch.id,
          documentId: d.id,
          embeddingModel: provider.model,
          embeddingVersion: provider.version,
          vector: v,
          dimensions: v.length,
        },
      ]);
    }

    const q = await provider.embed("专注");
    const hits = await store.query(q, { sourceTypes: ["user_material"], topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      const doc = db.docs.find((x) => x.id === h.documentId);
      expect(doc?.source_type).toBe("user_material");
    }
  });

  it("includeNonActive 默认 false（draft 不进 query）", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const store = new SqliteVectorStore(provider, db);

    const draft = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "草稿",
      fullText: "xyzzyvec",
      status: "draft",
    });
    const ch = (await rag.listChunksForDocument(draft.id))[0];
    const v = await provider.embed(ch.content);
    await store.upsert([
      {
        chunkId: ch.id,
        documentId: draft.id,
        embeddingModel: provider.model,
        embeddingVersion: provider.version,
        vector: v,
        dimensions: v.length,
      },
    ]);

    const q = await provider.embed("xyzzyvec");
    const hits = await store.query(q, { topK: 5 });
    expect(hits.find((h) => h.documentId === draft.id)).toBeUndefined();
  });

  it("deleteByDocument 生效", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const store = new SqliteVectorStore(provider, db);

    const doc = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "删",
      fullText: "待删除",
      status: "active",
    });
    const ch = (await rag.listChunksForDocument(doc.id))[0];
    const v = await provider.embed(ch.content);
    await store.upsert([
      {
        chunkId: ch.id,
        documentId: doc.id,
        embeddingModel: provider.model,
        embeddingVersion: provider.version,
        vector: v,
        dimensions: v.length,
      },
    ]);

    await store.deleteByDocument(doc.id, provider.model, provider.version);
    const q = await provider.embed("待删除");
    const hits = await store.query(q, { topK: 5 });
    expect(hits.length).toBe(0);
  });

  it("healthCheck 返回 ok", async () => {
    const store = new SqliteVectorStore(provider, buildFakeDb());
    const h = await store.healthCheck();
    expect(h.ok).toBe(true);
    expect(h.backend).toBe("sqlite-vector-json");
  });
});
