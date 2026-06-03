// ============================================================
// RagEvaluationService.ts — V3.8.5+ RAG 评测脚手架
// ============================================================

import { DEFAULT_RAG_EVAL_CASES } from "@/services/rag/eval/defaultRagEvalCases";
import type {
  RagEvalCase,
  RagEvalCaseResult,
  RagEvalMatchKind,
  RagEvalResult,
} from "@/services/rag/eval/RagEvalDataset";
import type { HybridRetriever } from "@/services/rag/retrieval/HybridRetriever";
import type { RagService } from "@/services/rag/RagService";
import type { VectorRagChunkHit } from "@/types/rag.types";

export type { RagEvalCase, RagEvalCaseResult, RagEvalResult } from "@/services/rag/eval/RagEvalDataset";

export class RagEvaluationService {
  constructor(
    private readonly retriever: HybridRetriever,
    private readonly rag: RagService,
  ) {}

  async evaluateDefault(): Promise<RagEvalResult> {
    return this.evaluate(DEFAULT_RAG_EVAL_CASES);
  }

  async evaluate(cases: RagEvalCase[]): Promise<RagEvalResult> {
    const perCase: RagEvalCaseResult[] = [];
    let matchedCount = 0;
    let sourceTypeHits = 0;
    let titleHits = 0;
    let scoreSum = 0;
    let scoreCount = 0;

    for (const c of cases) {
      const result = await this.evaluateOneCase(c);
      perCase.push(result);
      if (result.matched) matchedCount += 1;
      if (result.matchedBy === "sourceType") sourceTypeHits += 1;
      if (result.matchedBy === "title" || result.matchedBy === "titleContains") {
        titleHits += 1;
      }
      if (result.topScore != null) {
        scoreSum += result.topScore;
        scoreCount += 1;
      }
    }

    const totalCases = cases.length;
    const casesWithSourceType = cases.filter((c) => c.expectedSourceType).length;
    const casesWithTitle = cases.filter(
      (c) => c.expectedDocumentTitle || c.expectedTitleContains,
    ).length;

    return {
      totalCases,
      matchedCount,
      hitAtK: totalCases > 0 ? matchedCount / totalCases : 0,
      sourceTypeMatchRate:
        casesWithSourceType > 0 ? sourceTypeHits / casesWithSourceType : 0,
      titleMatchRate: casesWithTitle > 0 ? titleHits / casesWithTitle : 0,
      averageTopScore: scoreCount > 0 ? scoreSum / scoreCount : 0,
      perCase,
    };
  }

  private async evaluateOneCase(c: RagEvalCase): Promise<RagEvalCaseResult> {
    const topK = c.topK ?? 5;
    const hits = await this.retriever.retrieve(c.query, { limit: topK });

    let matched = false;
    let matchedBy: RagEvalMatchKind | undefined;
    let topHitTitle: string | undefined;
    const topScore = hits[0]?.score;

    if (hits.length > 0) {
      topHitTitle =
        (await this.rag.getDocumentTitle(hits[0].documentId)) ?? undefined;
    }

    for (const h of hits) {
      const m = await this.caseMatchesHit(c, h);
      if (m) {
        matched = true;
        matchedBy = m;
        break;
      }
    }

    return {
      id: c.id,
      query: c.query,
      matched,
      topHitTitle,
      topScore,
      matchedBy,
    };
  }

  private async caseMatchesHit(
    c: RagEvalCase,
    h: VectorRagChunkHit,
  ): Promise<RagEvalMatchKind | undefined> {
    if (c.expectedDocumentTitle) {
      const title = await this.rag.getDocumentTitle(h.documentId);
      if (title === c.expectedDocumentTitle) return "title";
    }
    if (c.expectedTitleContains) {
      const title = await this.rag.getDocumentTitle(h.documentId);
      if (title?.includes(c.expectedTitleContains)) return "titleContains";
    }
    if (c.expectedSourceType && h.sourceType === c.expectedSourceType) {
      return "sourceType";
    }
    if (c.expectedTags && c.expectedTags.length > 0) {
      const overlap = c.expectedTags.some((t) => h.tags.includes(t));
      if (overlap) return "tags";
    }
    return undefined;
  }
}
