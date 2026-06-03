// ============================================================
// KeywordSearch.ts — V3.8.5 关键词检索抽象
// ============================================================

import type { RagSourceType, VectorRagChunkHit } from "@/types/rag.types";

export interface KeywordSearchOptions {
  sourceTypes?: RagSourceType[];
  limit?: number;
  includeNonActive?: boolean;
}

export interface KeywordSearchHealth {
  ok: boolean;
  backend: string;
}

export interface KeywordSearch {
  search(query: string, opts?: KeywordSearchOptions): Promise<VectorRagChunkHit[]>;
  rebuildIndex?(): Promise<void>;
  healthCheck?(): Promise<KeywordSearchHealth>;
}
