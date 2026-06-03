// ============================================================
// EmbeddingProvider.ts — V3.8.3 嵌入向量提供者接口
// ============================================================

import type { EmbeddingVector } from "@/types/rag.types";

export interface EmbeddingProvider {
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  embed(text: string): Promise<EmbeddingVector>;
  /** 默认逐个 embed；生产可换批处理实现 */
  embedBatch(texts: string[]): Promise<EmbeddingVector[]>;
}

export async function embedBatchDefault(
  provider: EmbeddingProvider,
  texts: string[],
): Promise<EmbeddingVector[]> {
  const out: EmbeddingVector[] = [];
  for (const t of texts) {
    out.push(await provider.embed(t));
  }
  return out;
}
