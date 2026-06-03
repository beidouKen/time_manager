// ============================================================
// RagMetrics.ts — V3.8.6 检索计时与指标
// ============================================================

export interface RagRetrievalMetrics {
  retrievalTimeMs: number;
  keywordHitCount: number;
  vectorHitCount: number;
  fusedHitCount: number;
  rerankTimeMs: number;
  fallbackUsed: boolean;
}

export function emptyMetrics(): RagRetrievalMetrics {
  return {
    retrievalTimeMs: 0,
    keywordHitCount: 0,
    vectorHitCount: 0,
    fusedHitCount: 0,
    rerankTimeMs: 0,
    fallbackUsed: false,
  };
}

export function startTimer(): () => number {
  const t0 = performance.now();
  return () => Math.max(0, Math.round(performance.now() - t0));
}
