// ============================================================
// DisabledVectorStore.ts — V3.8.7 禁用向量检索（no-op）
// ============================================================

import type {
  VectorStore,
  VectorStoreHealth,
  VectorStoreHit,
  VectorStoreQueryOptions,
  VectorStoreUpsertItem,
} from "@/services/rag/vector/VectorStore";

export class DisabledVectorStore implements VectorStore {
  async upsert(_items: VectorStoreUpsertItem[]): Promise<void> {
    /* no-op */
  }

  async query(_vec: number[], _opts?: VectorStoreQueryOptions): Promise<VectorStoreHit[]> {
    return [];
  }

  async deleteByDocument(
    _documentId: string,
    _embeddingModel: string,
    _embeddingVersion: string,
  ): Promise<void> {
    /* no-op */
  }

  async healthCheck(): Promise<VectorStoreHealth> {
    return { ok: true, backend: "disabled" };
  }

  async countEmbeddings(): Promise<number> {
    return 0;
  }

  async listIndexedDocumentIds(): Promise<string[]> {
    return [];
  }

  async clearModel(
    _embeddingModel: string,
    _embeddingVersion: string,
  ): Promise<number> {
    return 0;
  }
}
