// ============================================================
// RerankerFactory.ts — V3.8.7 Reranker 工厂
// ============================================================

import type { RagRerankerKind } from "@/services/rag/engine/RagEngineConfig";
import type { RagService } from "@/services/rag/RagService";
import { NoopReranker, type Reranker } from "@/services/rag/rerank/Reranker";
import { ScoreReranker } from "@/services/rag/rerank/ScoreReranker";

function readRerankerEnv(): RagRerankerKind {
  if (typeof import.meta === "undefined") return "none";
  const raw = import.meta.env?.VITE_RAG_RERANKER;
  return raw === "score" ? "score" : "none";
}

export function resolveRerankerKindFromEnv(): RagRerankerKind {
  return readRerankerEnv();
}

export function createReranker(
  kind: RagRerankerKind = resolveRerankerKindFromEnv(),
  deps?: { rag?: RagService },
): Reranker {
  if (kind === "score") {
    return new ScoreReranker(deps?.rag);
  }
  return new NoopReranker();
}
