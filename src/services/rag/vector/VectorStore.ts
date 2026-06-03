// ============================================================
// VectorStore.ts — V3.8.4+ Self-hosted RAG Engine 向量存储抽象
// ============================================================

import type { RagSourceType } from "@/types/rag.types";

export interface VectorStoreUpsertItem {
  chunkId: string;
  documentId: string;
  embeddingModel: string;
  embeddingVersion: string;
  vector: number[];
  dimensions: number;
}

export interface VectorStoreQueryOptions {
  topK?: number;
  sourceTypes?: RagSourceType[];
  /** 默认仅 active */
  includeNonActive?: boolean;
}

export interface VectorStoreHit {
  chunkId: string;
  documentId: string;
  score: number;
}

export interface VectorStoreHealth {
  ok: boolean;
  backend: string;
}

/**
 * 可插拔向量存储后端。
 * 实现方须支持 metadata 过滤（sourceTypes、active、未软删）。
 */
export interface VectorStore {
  upsert(items: VectorStoreUpsertItem[]): Promise<void>;
  query(vec: number[], opts?: VectorStoreQueryOptions): Promise<VectorStoreHit[]>;
  deleteByDocument(
    documentId: string,
    embeddingModel: string,
    embeddingVersion: string,
  ): Promise<void>;
  healthCheck(): Promise<VectorStoreHealth>;
  /** V3.8.7：按 model/version 统计条数 */
  countEmbeddings?(embeddingModel?: string, embeddingVersion?: string): Promise<number>;
  /** V3.8.7：已索引的 document id 列表 */
  listIndexedDocumentIds?(
    embeddingModel?: string,
    embeddingVersion?: string,
  ): Promise<string[]>;
  /** V3.8.7：清除指定 model/version 的全部向量，返回删除条数 */
  clearModel?(embeddingModel: string, embeddingVersion: string): Promise<number>;
}
