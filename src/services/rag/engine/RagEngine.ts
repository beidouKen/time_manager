// ============================================================
// RagEngine.ts — V3.8.6 RAG 统一入口（只读检索 + 索引编排）
//
// 禁止 import ToolRouter / TaskService / TimeBlockService / ScheduleService
// ============================================================

import type { RagSnippet } from "@/agent/memory/RagAdapter";
import type { RagEvalCase, RagEvalResult } from "@/services/rag/eval/RagEvalDataset";
import type { RagEvaluationService } from "@/services/rag/eval/RagEvaluationService";
import type { RagEngineConfig, RagEngineMode } from "@/services/rag/engine/RagEngineConfig";
import type { EmbeddingProvider } from "@/services/rag/embedding/EmbeddingProvider";
import type { KeywordSearch } from "@/services/rag/keyword/KeywordSearch";
import type { RagIndexJob } from "@/services/rag/indexing/RagIndexJob";
import { RagIndexManager } from "@/services/rag/indexing/RagIndexManager";
import { RagDiagnostics } from "@/services/rag/metrics/RagDiagnostics";
import { RagRetrievalPipeline } from "@/services/rag/pipeline/RagRetrievalPipeline";
import type { RagPipelineDiagnostics } from "@/services/rag/pipeline/RagPipelineTypes";
import type { RagQueryContext, RagQueryStrategy } from "@/services/rag/query/RagQueryStrategy";
import type { RagIngestionService } from "@/services/rag/RagIngestionService";
import type { RagService } from "@/services/rag/RagService";
import type { HybridRetriever } from "@/services/rag/retrieval/HybridRetriever";
import type { Reranker } from "@/services/rag/rerank/Reranker";
import type { VectorStore } from "@/services/rag/vector/VectorStore";
import type {
  IngestDocumentInput,
  RagDocument,
  RagSourceType,
  VectorRagChunkHit,
} from "@/types/rag.types";

export interface RagRetrieveOptions {
  sourceTypes?: RagSourceType[];
  limit?: number;
  includeNonActive?: boolean;
  context?: Partial<RagQueryContext>;
}

export interface RagEngineRetrieveResult {
  hits: VectorRagChunkHit[];
  snippets: RagSnippet[];
  diagnostics: RagPipelineDiagnostics;
}

export interface RagEngineHealth {
  ok: boolean;
  mode: RagEngineMode;
  keyword: { ok: boolean; backend: string };
  vector: { ok: boolean; backend: string };
}

export class RagEngine {
  private readonly config: RagEngineConfig;
  private readonly ingestion: RagIngestionService;
  private readonly pipeline: RagRetrievalPipeline;
  private readonly indexManager: RagIndexManager;
  private readonly diagnostics: RagDiagnostics;
  private readonly evaluation?: RagEvaluationService;

  constructor(deps: {
      config: RagEngineConfig;
      rag: RagService;
      ingestion: RagIngestionService;
      embeddingProvider: EmbeddingProvider;
      keyword?: KeywordSearch;
      vectorStore?: VectorStore;
      retriever: HybridRetriever;
      reranker: Reranker;
      queryStrategy: RagQueryStrategy;
      pipeline: RagRetrievalPipeline;
      indexManager: RagIndexManager;
      evaluation?: RagEvaluationService;
    },
  ) {
    this.config = deps.config;
    this.ingestion = deps.ingestion;
    this.pipeline = deps.pipeline;
    this.indexManager = deps.indexManager;
    this.diagnostics = new RagDiagnostics({
      keyword: deps.keyword,
      vectorStore: deps.vectorStore,
    });
    this.evaluation = deps.evaluation;
  }

  async retrieve(
    query: string,
    opts: RagRetrieveOptions = {},
  ): Promise<RagEngineRetrieveResult> {
    const context: RagQueryContext = {
      userInput: query,
      ...opts.context,
    };
    const out = await this.pipeline.run({
      context,
      sourceTypes: opts.sourceTypes,
      limit: opts.limit ?? this.config.defaultLimit,
      includeNonActive: opts.includeNonActive,
    });
    return {
      hits: out.hits,
      snippets: out.snippets,
      diagnostics: out.diagnostics,
    };
  }

  async ingest(input: IngestDocumentInput): Promise<RagDocument> {
    return this.ingestion.createDraftDocument(input);
  }

  async activateDocument(id: string): Promise<RagIndexJob | null> {
    await this.ingestion.activateDocument(id);
    return this.indexManager.refreshDocument(id);
  }

  async archiveDocument(id: string): Promise<void> {
    await this.ingestion.archiveDocument(id);
  }

  async softDeleteDocument(id: string): Promise<void> {
    await this.ingestion.softDeleteDocument(id);
  }

  async rebuildIndexes(
    opts: { sourceTypes?: RagSourceType[] } = {},
  ): Promise<RagIndexJob[]> {
    return this.indexManager.rebuildAll(opts);
  }

  async rebuildKeywordIndex(): Promise<RagIndexJob> {
    return this.indexManager.rebuildKeywordIndex();
  }

  async rebuildVectorIndex(
    opts: { sourceTypes?: RagSourceType[] } = {},
  ): Promise<RagIndexJob> {
    return this.indexManager.rebuildVectorIndex(opts);
  }

  async refreshDocumentIndexes(documentId: string): Promise<RagIndexJob> {
    return this.indexManager.refreshDocument(documentId);
  }

  async evaluate(cases: RagEvalCase[]): Promise<RagEvalResult> {
    if (!this.evaluation) {
      throw new Error(
        "[RagEngine] evaluation unavailable; enable evaluation or admin actions",
      );
    }
    if (!this.config.enableEvaluation && !this.config.enableAdminActions) {
      throw new Error(
        "[RagEngine] evaluation disabled; set enableEvaluation or enableAdminActions",
      );
    }
    return this.evaluation.evaluate(cases);
  }

  async evaluateDefault(): Promise<RagEvalResult> {
    if (!this.evaluation) {
      throw new Error("[RagEngine] evaluation unavailable");
    }
    return this.evaluation.evaluateDefault();
  }

  async clearVectorIndex(model: string, version: string): Promise<RagIndexJob> {
    return this.indexManager.clearVectorIndex(model, version);
  }

  async reindexForEmbeddingModelChange(
    oldModel: string,
    oldVersion: string,
    newModel: string,
    newVersion: string,
    opts?: { sourceTypes?: RagSourceType[] },
  ): Promise<RagIndexJob[]> {
    return this.indexManager.reindexForEmbeddingModelChange(
      oldModel,
      oldVersion,
      newModel,
      newVersion,
      opts,
    );
  }

  async healthCheck(): Promise<RagEngineHealth> {
    const h = await this.diagnostics.collectHealth();
    return {
      ok: h.keyword.ok && h.vector.ok,
      mode: this.config.mode,
      keyword: h.keyword,
      vector: h.vector,
    };
  }
}
