// ============================================================
// buildSelfHostedHybridRetriever.ts — V3.8.5 装配 Self-hosted RAG 栈
// ============================================================

import { createDefaultEmbeddingProvider } from "@/services/rag/embedding/embeddingProviderFactory";
import { SqliteFtsKeywordSearch } from "@/services/rag/keyword/SqliteFtsKeywordSearch";
import type { HybridRetriever } from "@/services/rag/retrieval/HybridRetriever";
import { SelfHostedHybridRetriever } from "@/services/rag/retrieval/SelfHostedHybridRetriever";
import { RagService } from "@/services/rag/RagService";
import { SqliteVectorStore } from "@/services/rag/vector/SqliteVectorStore";

/**
 * 构建 Self-hosted HybridRetriever；失败返回 undefined（调用方 fallback V3.8.3）。
 */
export function buildSelfHostedHybridRetriever(): HybridRetriever | undefined {
  try {
    const provider = createDefaultEmbeddingProvider();
    const rag = new RagService();
    const keyword = new SqliteFtsKeywordSearch(rag);
    const vectorStore = new SqliteVectorStore(provider);
    return new SelfHostedHybridRetriever({
      keyword,
      vectorStore,
      embeddingProvider: provider,
      ragService: rag,
    });
  } catch (e) {
    console.warn("[buildSelfHostedHybridRetriever] failed:", e);
    return undefined;
  }
}

export function isSelfHostedRagEngineEnabled(): boolean {
  return (
    typeof import.meta !== "undefined" &&
    import.meta.env?.VITE_RAG_ENGINE === "self_hosted"
  );
}
