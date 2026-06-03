// ============================================================
// rrfFusion.ts — V3.8.5 Reciprocal Rank Fusion
// ============================================================

import type { VectorRagChunkHit } from "@/types/rag.types";

export const DEFAULT_RRF_K = 60;

export interface RrfInputList {
  source: "vector" | "keyword";
  hits: VectorRagChunkHit[];
}

/**
 * 对多路召回结果做 RRF 融合并去重（同 chunkId 一条）。
 */
export function fuseRrf(
  lists: RrfInputList[],
  opts: { k?: number; limit?: number } = {},
): VectorRagChunkHit[] {
  const k = opts.k ?? DEFAULT_RRF_K;
  const limit = opts.limit ?? 5;

  const scoreMap = new Map<string, number>();
  const hitMap = new Map<string, VectorRagChunkHit>();
  const sourcesMap = new Map<string, Set<"vector" | "keyword">>();

  for (const { source, hits } of lists) {
    const sorted = [...hits].sort((a, b) => b.score - a.score);
    for (let rank = 0; rank < sorted.length; rank += 1) {
      const h = sorted[rank];
      const id = h.id;
      const rrf = 1 / (k + rank + 1);
      scoreMap.set(id, (scoreMap.get(id) ?? 0) + rrf);
      if (!hitMap.has(id)) hitMap.set(id, h);
      const src = sourcesMap.get(id) ?? new Set();
      src.add(source);
      sourcesMap.set(id, src);
    }
  }

  const merged: VectorRagChunkHit[] = [];
  for (const [id, rrfScore] of scoreMap.entries()) {
    const base = hitMap.get(id)!;
    const sources = sourcesMap.get(id)!;
    const sourcesArr = Array.from(sources);
    merged.push({
      ...base,
      score: rrfScore,
      retrieveMode:
        sourcesArr.length > 1 ? "hybrid" : sourcesArr[0] === "vector" ? "vector" : "keyword",
      retrievalSources: sourcesArr,
    });
  }

  merged.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return merged.slice(0, limit);
}
