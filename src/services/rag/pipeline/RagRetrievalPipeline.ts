// ============================================================
// RagRetrievalPipeline.ts — V3.8.6 buildQuery → retrieve → rerank → sanitize
// ============================================================

import type { RagSnippet } from "@/agent/memory/RagAdapter";
import type { RagEngineConfig } from "@/services/rag/engine/RagEngineConfig";
import { emptyMetrics, startTimer } from "@/services/rag/metrics/RagMetrics";
import { RagDiagnostics } from "@/services/rag/metrics/RagDiagnostics";
import type {
  RagPipelineInput,
  RagPipelineOutput,
} from "@/services/rag/pipeline/RagPipelineTypes";
import type { RagQueryStrategy } from "@/services/rag/query/RagQueryStrategy";
import type { HybridRetriever } from "@/services/rag/retrieval/HybridRetriever";
import type { Reranker } from "@/services/rag/rerank/Reranker";
import type { VectorRagChunkHit } from "@/types/rag.types";

const SNIPPET_MAX_LEN = 600;

function truncateContent(text: string, max = SNIPPET_MAX_LEN): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function countBySource(hits: VectorRagChunkHit[]): {
  keyword: number;
  vector: number;
} {
  let keyword = 0;
  let vector = 0;
  for (const h of hits) {
    const sources = h.retrievalSources ?? [h.retrieveMode];
    if (sources.includes("keyword")) keyword += 1;
    if (sources.includes("vector")) vector += 1;
  }
  return { keyword, vector };
}

function hitsToSnippets(hits: VectorRagChunkHit[]): RagSnippet[] {
  return hits.map((h) => ({
    content: truncateContent(h.content),
    relevance: h.score,
    source: `${h.sourceType}:${h.documentId}`,
  }));
}

export class RagRetrievalPipeline {
  private readonly config: RagEngineConfig;
  private readonly queryStrategy: RagQueryStrategy;
  private readonly retriever: HybridRetriever;
  private readonly reranker: Reranker;
  private readonly keywordHealth?: () => Promise<{ backend: string }>;
  private readonly vectorHealth?: () => Promise<{ backend: string }>;
  private readonly diagnostics: RagDiagnostics;

  constructor(deps: {
    config: RagEngineConfig;
    queryStrategy: RagQueryStrategy;
    retriever: HybridRetriever;
    reranker: Reranker;
    keywordHealth?: () => Promise<{ backend: string }>;
    vectorHealth?: () => Promise<{ backend: string }>;
    diagnostics?: RagDiagnostics;
  }) {
    this.config = deps.config;
    this.queryStrategy = deps.queryStrategy;
    this.retriever = deps.retriever;
    this.reranker = deps.reranker;
    this.keywordHealth = deps.keywordHealth;
    this.vectorHealth = deps.vectorHealth;
    this.diagnostics =
      deps.diagnostics ??
      new RagDiagnostics({ keyword: undefined, vectorStore: undefined });
  }

  async run(input: RagPipelineInput): Promise<RagPipelineOutput> {
    const plan = this.queryStrategy.buildQuery(input.context);
    const limit = input.limit ?? this.config.defaultLimit ?? 5;

    let keywordBackend = "unknown";
    let vectorBackend = "unknown";
    if (this.keywordHealth) {
      try {
        keywordBackend = (await this.keywordHealth()).backend;
      } catch {
        keywordBackend = "error";
      }
    }
    if (this.vectorHealth) {
      try {
        vectorBackend = (await this.vectorHealth()).backend;
      } catch {
        vectorBackend = "error";
      }
    }

    const metrics = emptyMetrics();
    const retrievalTimer = startTimer();

    let hits: VectorRagChunkHit[] = [];
    let preRerankHits: VectorRagChunkHit[] = [];

    if (plan.queryText.trim()) {
      try {
        preRerankHits = await this.retriever.retrieve(plan.queryText, {
          sourceTypes: input.sourceTypes,
          limit,
          includeNonActive: input.includeNonActive,
        });
        const counts = countBySource(preRerankHits);
        metrics.keywordHitCount = counts.keyword;
        metrics.vectorHitCount = counts.vector;
      } catch {
        metrics.fallbackUsed = true;
        preRerankHits = [];
      }
    }

    metrics.retrievalTimeMs = retrievalTimer();

    const rerankTimer = startTimer();
    try {
      hits = await this.reranker.rerank(plan.queryText, preRerankHits);
    } catch {
      metrics.fallbackUsed = true;
      hits = preRerankHits;
    }
    metrics.rerankTimeMs = rerankTimer();
    metrics.fusedHitCount = hits.length;

    const snippets = hitsToSnippets(hits);
    const diagnostics = this.diagnostics.buildPipelineDiagnostics({
      config: this.config,
      metrics,
      keywordBackend,
      vectorBackend,
      queryPlanReason: plan.reason,
    });

    return { hits, snippets, diagnostics };
  }
}
