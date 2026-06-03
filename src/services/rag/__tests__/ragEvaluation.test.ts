// ============================================================
// ragEvaluation.test.ts — V3.8.5 RagEvaluationService
// ============================================================

import { describe, expect, it } from "vitest";
import { RagEvaluationService } from "@/services/rag/eval/RagEvaluationService";
import type { RagEvalCase } from "@/services/rag/eval/RagEvalDataset";
import type { HybridRetriever } from "@/services/rag/retrieval/HybridRetriever";
import { RagService } from "@/services/rag/RagService";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import type { VectorRagChunkHit } from "@/types/rag.types";

describe("RagEvaluationService", () => {
  it("输出 hit@K 与 perCase 形状", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);

    const doc = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "番茄工作法指南",
      fullText: "番茄工作法 25 分钟专注",
      status: "active",
    });

    const mockRetriever: HybridRetriever = {
      retrieve: async () => [
        {
          id: "c1",
          documentId: doc.id,
          chunkIndex: 0,
          content: "番茄工作法",
          tags: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          score: 0.9,
          sourceType: "seed_knowledge",
          retrieveMode: "hybrid",
        } satisfies VectorRagChunkHit,
      ],
    };

    const evalSvc = new RagEvaluationService(mockRetriever, rag);
    const cases: RagEvalCase[] = [
      {
        id: "1",
        query: "番茄",
        expectedDocumentTitle: "番茄工作法指南",
        topK: 3,
      },
      {
        id: "2",
        query: "不存在",
        expectedDocumentTitle: "无此文档",
        topK: 3,
      },
      {
        id: "3",
        query: "番茄",
        expectedSourceType: "seed_knowledge",
        topK: 3,
      },
    ];
    const result = await evalSvc.evaluate(cases);

    expect(result.totalCases).toBe(3);
    expect(result.matchedCount).toBeGreaterThanOrEqual(2);
    expect(result.hitAtK).toBeGreaterThan(0);
    expect(result.perCase).toHaveLength(3);
    expect(result.sourceTypeMatchRate).toBeGreaterThanOrEqual(0);
    expect(result.averageTopScore).toBeGreaterThan(0);
    expect(result.perCase[0].matched).toBe(true);
    expect(result.perCase[0].topHitTitle).toBe("番茄工作法指南");
  });
});
