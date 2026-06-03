// ============================================================
// VectorStoreFactory.ts — V3.8.7 VectorStore 工厂
// ============================================================

import type { EmbeddingProvider } from "@/services/rag/embedding/EmbeddingProvider";
import type { RagVectorBackend } from "@/services/rag/engine/RagEngineConfig";
import { DisabledVectorStore } from "@/services/rag/vector/DisabledVectorStore";
import { SqliteVectorStore } from "@/services/rag/vector/SqliteVectorStore";
import type { VectorStore } from "@/services/rag/vector/VectorStore";

export function createVectorStore(
  backend: RagVectorBackend,
  provider: EmbeddingProvider,
): VectorStore {
  try {
    if (backend === "disabled") {
      return new DisabledVectorStore();
    }
    return new SqliteVectorStore(provider);
  } catch (e) {
    console.warn("[VectorStoreFactory] create failed, fallback disabled:", e);
    return new DisabledVectorStore();
  }
}
