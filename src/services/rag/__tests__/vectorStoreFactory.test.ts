// ============================================================
// vectorStoreFactory.test.ts — V3.8.7
// ============================================================

import { describe, expect, it } from "vitest";
import { DeterministicEmbeddingProvider } from "@/services/rag/embedding/DeterministicEmbeddingProvider";
import { DisabledVectorStore } from "@/services/rag/vector/DisabledVectorStore";
import { SqliteVectorStore } from "@/services/rag/vector/SqliteVectorStore";
import { createVectorStore } from "@/services/rag/vector/VectorStoreFactory";

describe("VectorStoreFactory", () => {
  const provider = new DeterministicEmbeddingProvider();

  it("disabled 返回 DisabledVectorStore", () => {
    const vs = createVectorStore("disabled", provider);
    expect(vs).toBeInstanceOf(DisabledVectorStore);
  });

  it("sqlite_json 返回 SqliteVectorStore", () => {
    const vs = createVectorStore("sqlite_json", provider);
    expect(vs).toBeInstanceOf(SqliteVectorStore);
  });
});

describe("DisabledVectorStore", () => {
  const vs = new DisabledVectorStore();

  it("query 返回空且不抛", async () => {
    expect(await vs.query([1, 2, 3])).toEqual([]);
    await vs.upsert([]);
    await vs.deleteByDocument("d", "m", "v");
    const h = await vs.healthCheck();
    expect(h.backend).toBe("disabled");
    expect(await vs.countEmbeddings()).toBe(0);
    expect(await vs.listIndexedDocumentIds()).toEqual([]);
    expect(await vs.clearModel("m", "v")).toBe(0);
  });
});
