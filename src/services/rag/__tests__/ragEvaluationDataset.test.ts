// ============================================================
// ragEvaluationDataset.test.ts — V3.8.7
// ============================================================

import { describe, expect, it } from "vitest";
import { DEFAULT_RAG_EVAL_CASES } from "@/services/rag/eval/defaultRagEvalCases";
import { RagEvaluationService } from "@/services/rag/eval/RagEvaluationService";
import type { HybridRetriever } from "@/services/rag/retrieval/HybridRetriever";
import { RagService } from "@/services/rag/RagService";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import type { VectorRagChunkHit } from "@/types/rag.types";

describe("RagEvaluationService dataset", () => {
  it("默认 5 条 case", () => {
    expect(DEFAULT_RAG_EVAL_CASES).toHaveLength(5);
    expect(DEFAULT_RAG_EVAL_CASES.map((c) => c.id)).toContain("pomodoro");
  });

  it("evaluateDefault 返回扩展指标", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const doc = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "番茄工作法",
      fullText: "番茄工作法 25 分钟专注",
      status: "active",
      tags: ["番茄钟", "专注"],
    });

    const retriever: HybridRetriever = {
      retrieve: async () => [
        {
          id: "c1",
          documentId: doc.id,
          chunkIndex: 0,
          content: "番茄",
          tags: ["番茄钟"],
          createdAt: "2026-01-01T00:00:00.000Z",
          score: 0.88,
          sourceType: "seed_knowledge",
          retrieveMode: "hybrid",
        } satisfies VectorRagChunkHit,
      ],
    };

    const svc = new RagEvaluationService(retriever, rag);
    const r = await svc.evaluateDefault();
    expect(r.totalCases).toBe(5);
    expect(r.hitAtK).toBeGreaterThan(0);
    expect(r.sourceTypeMatchRate).toBeGreaterThanOrEqual(0);
    expect(r.titleMatchRate).toBeGreaterThanOrEqual(0);
    expect(r.averageTopScore).toBeGreaterThan(0);
    expect(r.perCase[0].id).toBe("pomodoro");
    expect(r.perCase[0].matched).toBe(true);
  });

  it("expectedTitleContains 与 tags 命中", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const doc = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "艾宾浩斯遗忘曲线",
      fullText: "间隔复习",
      status: "active",
      tags: ["间隔重复"],
    });
    const retriever: HybridRetriever = {
      retrieve: async () => [
        {
          id: "c1",
          documentId: doc.id,
          chunkIndex: 0,
          content: "x",
          tags: ["间隔重复"],
          createdAt: "2026-01-01T00:00:00.000Z",
          score: 0.7,
          sourceType: "seed_knowledge",
          retrieveMode: "keyword",
        },
      ],
    };
    const svc = new RagEvaluationService(retriever, rag);
    const r = await svc.evaluate([
      {
        id: "t1",
        query: "间隔",
        expectedTitleContains: "艾宾浩斯",
        expectedTags: ["间隔重复"],
        topK: 3,
      },
    ]);
    expect(r.perCase[0].matched).toBe(true);
    expect(r.perCase[0].matchedBy).toBeTruthy();
  });
});
