// ============================================================
// scoreReranker.test.ts — V3.8.7
// ============================================================

import { describe, expect, it } from "vitest";
import { ScoreReranker } from "@/services/rag/rerank/ScoreReranker";
import { RagService } from "@/services/rag/RagService";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import type { VectorRagChunkHit } from "@/types/rag.types";
import scoreRerankerSource from "@/services/rag/rerank/ScoreReranker.ts?raw";

function hit(
  id: string,
  score: number,
  sourceType: VectorRagChunkHit["sourceType"] = "user_material",
  docId = `doc-${id}`,
  dualSource = true,
): VectorRagChunkHit {
  return {
    id,
    documentId: docId,
    chunkIndex: 0,
    content: "c",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    score,
    sourceType,
    retrieveMode: "hybrid",
    retrievalSources: dualSource ? ["vector", "keyword"] : ["vector"],
  };
}

describe("ScoreReranker", () => {
  it("不改变候选数量", async () => {
    const reranker = new ScoreReranker();
    const candidates = [hit("a", 0.5), hit("b", 0.6, "seed_knowledge")];
    const out = await reranker.rerank("q", candidates);
    expect(out).toHaveLength(2);
  });

  it("seed_knowledge 加权后排前", async () => {
    const reranker = new ScoreReranker();
    const candidates = [
      hit("low", 0.62, "user_material", "doc-low", false),
      hit("seed", 0.55, "seed_knowledge"),
    ];
    const out = await reranker.rerank("q", candidates);
    expect(out[0].id).toBe("seed");
  });

  it("high trust 加权", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const doc = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "高信任",
      fullText: "内容",
      status: "active",
      trustLevel: "high",
    });
    const reranker = new ScoreReranker(rag);
    const out = await reranker.rerank("q", [
      hit("h", 0.5, "seed_knowledge", doc.id),
      hit("o", 0.55, "user_material", "other-doc"),
    ]);
    expect(out[0].documentId).toBe(doc.id);
  });

  it("源码不写业务库", () => {
    expect(scoreRerankerSource).not.toMatch(/from ["']@\/.*ToolRouter/);
    expect(scoreRerankerSource).not.toMatch(/from ["']@\/.*TaskService/);
  });
});
