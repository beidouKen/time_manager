// ============================================================
// DeterministicEmbeddingProvider.ts — V3.8.3 本地确定性嵌入（无 API）
//
// 用途：测试、无 API key 开发、启动时自动建索引。
// 算法：token 哈希桶 + L2 归一化；同文本严格稳定。
// 不追求真实语义效果，只证明向量管线可运行。
// ============================================================

import { tokenize } from "@/services/rag/ragRanking";
import type { EmbeddingProvider } from "@/services/rag/embedding/EmbeddingProvider";
import type { EmbeddingVector } from "@/types/rag.types";

const MODEL = "deterministic-local";
const VERSION = "v1";
const DIMENSIONS = 64;

/** FNV-1a 32-bit */
function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function l2Normalize(vec: EmbeddingVector): EmbeddingVector {
  let sum = 0;
  for (const v of vec) sum += v * v;
  if (sum === 0) return vec.slice();
  const inv = 1 / Math.sqrt(sum);
  return vec.map((v) => v * inv);
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly model = MODEL;
  readonly version = VERSION;
  readonly dimensions = DIMENSIONS;

  async embed(text: string): Promise<EmbeddingVector> {
    const trimmed = text.trim();
    const vec = new Array<number>(DIMENSIONS).fill(0);
    if (!trimmed) return vec;

    const tokens = tokenize(trimmed);
    for (const t of tokens) {
      const idx = fnv1a(t) % DIMENSIONS;
      vec[idx] += 1;
    }
    return l2Normalize(vec);
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    const out: EmbeddingVector[] = [];
    for (const t of texts) {
      out.push(await this.embed(t));
    }
    return out;
  }
}
