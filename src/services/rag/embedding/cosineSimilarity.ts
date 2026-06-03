// ============================================================
// cosineSimilarity.ts — V3.8.3 内存向量相似度（纯函数）
// ============================================================

import type { EmbeddingVector } from "@/types/rag.types";

/**
 * 计算两向量的余弦相似度。
 * 零向量与任意向量返回 0，避免除零。
 */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
