// ============================================================
// RagPipelineTypes.ts — V3.8.6 检索管线输入/输出与诊断
// ============================================================

import type { RagEngineMode } from "@/services/rag/engine/RagEngineConfig";
import type { RagQueryContext } from "@/services/rag/query/RagQueryStrategy";
import type { RagSnippet } from "@/agent/memory/RagAdapter";
import type { RagSourceType, VectorRagChunkHit } from "@/types/rag.types";

export interface RagPipelineDiagnostics {
  mode: RagEngineMode;
  keywordBackend: string;
  vectorBackend: string;
  retrievalTimeMs: number;
  rerankTimeMs: number;
  hitCount: number;
  keywordHitCount: number;
  vectorHitCount: number;
  fusedHitCount: number;
  fallbackUsed: boolean;
  queryPlanReason: string;
}

export interface RagPipelineInput {
  context: RagQueryContext;
  sourceTypes?: RagSourceType[];
  includeNonActive?: boolean;
  limit?: number;
}

export interface RagPipelineOutput {
  hits: VectorRagChunkHit[];
  snippets: RagSnippet[];
  diagnostics: RagPipelineDiagnostics;
}
