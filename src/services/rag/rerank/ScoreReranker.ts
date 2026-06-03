// ============================================================
// ScoreReranker.ts — V3.8.7 规则版重排序（无外部 API）
// ============================================================

import type { RagService } from "@/services/rag/RagService";
import type { Reranker } from "@/services/rag/rerank/Reranker";
import type { RagTrustLevel, VectorRagChunkHit } from "@/types/rag.types";

const SEED_BOOST = 0.05;
const HIGH_TRUST_BOOST = 0.05;
const DUAL_SOURCE_BOOST = 0.03;

export class ScoreReranker implements Reranker {
  private readonly trustCache = new Map<string, RagTrustLevel | undefined>();

  constructor(private readonly rag?: RagService) {}

  async rerank(
    _query: string,
    candidates: VectorRagChunkHit[],
  ): Promise<VectorRagChunkHit[]> {
    if (candidates.length === 0) return [];

    try {
      const scored = await Promise.all(
        candidates.map(async (c) => ({
          hit: c,
          adjusted: await this.adjustScore(c),
        })),
      );
      scored.sort((a, b) => b.adjusted - a.adjusted || a.hit.id.localeCompare(b.hit.id));
      return scored.map(({ hit, adjusted }) => ({ ...hit, score: adjusted }));
    } catch {
      return candidates;
    }
  }

  private async adjustScore(hit: VectorRagChunkHit): Promise<number> {
    let score = hit.score;
    if (hit.sourceType === "seed_knowledge") {
      score += SEED_BOOST;
    }
    const trust = await this.resolveTrustLevel(hit.documentId);
    if (trust === "high") {
      score += HIGH_TRUST_BOOST;
    }
    if (hit.retrievalSources && hit.retrievalSources.length >= 2) {
      score += DUAL_SOURCE_BOOST;
    }
    return score;
  }

  private async resolveTrustLevel(documentId: string): Promise<RagTrustLevel | undefined> {
    if (!this.rag) return undefined;
    if (this.trustCache.has(documentId)) {
      return this.trustCache.get(documentId);
    }
    try {
      const doc = await this.rag.getDocument(documentId);
      const level = doc?.trustLevel;
      this.trustCache.set(documentId, level);
      return level;
    } catch {
      return undefined;
    }
  }
}
