// ============================================================
// RagEngineFactory.ts — V3.8.6+ 从 env 装配 RagEngine（V3.8.7 增强）
// ============================================================

import {
  createDefaultEmbeddingProvider,
  resolveEmbeddingProviderEnv,
} from "@/services/rag/embedding/embeddingProviderFactory";
import { RagEvaluationService } from "@/services/rag/eval/RagEvaluationService";
import {
  DEFAULT_LEGACY_CONFIG,
  DEFAULT_SELF_HOSTED_CONFIG,
  mergeRagEngineConfig,
  type RagEngineConfig,
  type RagEmbeddingProviderKind,
} from "@/services/rag/engine/RagEngineConfig";
import { RagEngine } from "@/services/rag/engine/RagEngine";
import { SqliteFtsKeywordSearch } from "@/services/rag/keyword/SqliteFtsKeywordSearch";
import { RagIndexManager } from "@/services/rag/indexing/RagIndexManager";
import { RagDiagnostics } from "@/services/rag/metrics/RagDiagnostics";
import { RagRetrievalPipeline } from "@/services/rag/pipeline/RagRetrievalPipeline";
import { DefaultRagQueryStrategy } from "@/services/rag/query/DefaultRagQueryStrategy";
import { RagIngestionService } from "@/services/rag/RagIngestionService";
import { RagService } from "@/services/rag/RagService";
import {
  LegacyHybridRetriever,
  type HybridRetriever,
} from "@/services/rag/retrieval/HybridRetriever";
import { SelfHostedHybridRetriever } from "@/services/rag/retrieval/SelfHostedHybridRetriever";
import { isSelfHostedRagEngineEnabled } from "@/services/rag/retrieval/buildSelfHostedHybridRetriever";
import { createReranker, resolveRerankerKindFromEnv } from "@/services/rag/rerank/RerankerFactory";
import { VectorRagService } from "@/services/rag/VectorRagService";
import { createVectorStore } from "@/services/rag/vector/VectorStoreFactory";
import type { VectorStore } from "@/services/rag/vector/VectorStore";
import type { EmbeddingProvider } from "@/services/rag/embedding/EmbeddingProvider";
import { DeterministicEmbeddingProvider } from "@/services/rag/embedding/DeterministicEmbeddingProvider";

function readEnvProviderKind(): RagEmbeddingProviderKind {
  const env = resolveEmbeddingProviderEnv();
  return env.provider;
}

export function resolveRagEngineConfigFromEnv(
  partial?: Partial<RagEngineConfig>,
): RagEngineConfig {
  const base = isSelfHostedRagEngineEnabled()
    ? DEFAULT_SELF_HOSTED_CONFIG
    : DEFAULT_LEGACY_CONFIG;
  const merged = mergeRagEngineConfig(base, partial);
  return {
    ...merged,
    embeddingProvider: partial?.embeddingProvider ?? readEnvProviderKind(),
    reranker: partial?.reranker ?? resolveRerankerKindFromEnv(),
  };
}

function safeCreateProvider(): EmbeddingProvider {
  try {
    return createDefaultEmbeddingProvider();
  } catch (e) {
    console.warn("[RagEngineFactory] embedding provider failed, fallback deterministic:", e);
    return new DeterministicEmbeddingProvider();
  }
}

function safeCreateVectorStore(
  backend: RagEngineConfig["vectorBackend"],
  provider: EmbeddingProvider,
): VectorStore {
  try {
    return createVectorStore(backend, provider);
  } catch (e) {
    console.warn("[RagEngineFactory] vector store failed, fallback disabled:", e);
    return createVectorStore("disabled", provider);
  }
}

export function createRagEngine(config?: Partial<RagEngineConfig>): RagEngine {
  const resolved = resolveRagEngineConfigFromEnv(config);
  const provider = safeCreateProvider();
  const rag = new RagService();
  const vector = new VectorRagService(rag, provider);
  const keyword = new SqliteFtsKeywordSearch(rag);
  const vectorStore = safeCreateVectorStore(resolved.vectorBackend, provider);
  const reranker = createReranker(resolved.reranker, { rag });

  let retriever: HybridRetriever;
  if (resolved.mode === "self_hosted") {
    retriever = new SelfHostedHybridRetriever({
      keyword,
      vectorStore,
      embeddingProvider: provider,
      ragService: rag,
      reranker,
      rrfK: resolved.rrfK ?? 60,
    });
  } else {
    retriever = new LegacyHybridRetriever(vector);
  }

  const queryStrategy = new DefaultRagQueryStrategy();
  const diagnostics = new RagDiagnostics({ keyword, vectorStore });

  const pipeline = new RagRetrievalPipeline({
    config: resolved,
    queryStrategy,
    retriever,
    reranker,
    keywordHealth: async () => {
      const h = (await keyword.healthCheck?.()) ?? {
        ok: true,
        backend: "unknown",
      };
      return { backend: h.backend };
    },
    vectorHealth: async () => {
      const h = await vectorStore.healthCheck();
      return { backend: h.backend };
    },
    diagnostics,
  });

  const ingestion = new RagIngestionService(rag, vector, keyword);
  const indexManager = new RagIndexManager({ rag, vector, keyword, vectorStore });

  const needEval = resolved.enableEvaluation || resolved.enableAdminActions;
  const evaluation = needEval
    ? new RagEvaluationService(retriever, rag)
    : undefined;

  return new RagEngine({
    config: resolved,
    rag,
    ingestion,
    embeddingProvider: provider,
    keyword,
    vectorStore,
    retriever,
    reranker,
    queryStrategy,
    pipeline,
    indexManager,
    evaluation,
  });
}

export function createDefaultRagEngine(): RagEngine | undefined {
  try {
    return createRagEngine();
  } catch (e) {
    console.warn("[createDefaultRagEngine] failed:", e);
    return undefined;
  }
}
