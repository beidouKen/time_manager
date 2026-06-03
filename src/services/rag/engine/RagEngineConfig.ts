// ============================================================
// RagEngineConfig.ts — V3.8.6+ RAG Engine 配置类型与默认值
// ============================================================

export type RagEngineMode = "legacy" | "self_hosted";
export type RagKeywordBackend = "like" | "fts5";
export type RagVectorBackend = "sqlite_json" | "disabled";
export type RagEmbeddingProviderKind = "deterministic" | "openai_compatible";
export type RagRerankerKind = "none" | "score";

export interface RagEngineConfig {
  mode: RagEngineMode;
  keywordBackend: RagKeywordBackend;
  vectorBackend: RagVectorBackend;
  embeddingProvider: RagEmbeddingProviderKind;
  reranker: RagRerankerKind;
  enableEvaluation: boolean;
  enableAdminActions: boolean;
  defaultLimit?: number;
  rrfK?: number;
}

function isAdminEnabled(): boolean {
  return (
    typeof import.meta !== "undefined" &&
    import.meta.env?.VITE_ENABLE_RAG_ADMIN === "true"
  );
}

export const DEFAULT_LEGACY_CONFIG: RagEngineConfig = {
  mode: "legacy",
  keywordBackend: "like",
  vectorBackend: "sqlite_json",
  embeddingProvider: "deterministic",
  reranker: "none",
  enableEvaluation: false,
  enableAdminActions: isAdminEnabled(),
  defaultLimit: 5,
  rrfK: 60,
};

export const DEFAULT_SELF_HOSTED_CONFIG: RagEngineConfig = {
  mode: "self_hosted",
  keywordBackend: "fts5",
  vectorBackend: "sqlite_json",
  embeddingProvider: "deterministic",
  reranker: "none",
  enableEvaluation: false,
  enableAdminActions: isAdminEnabled(),
  defaultLimit: 5,
  rrfK: 60,
};

export function mergeRagEngineConfig(
  base: RagEngineConfig,
  partial?: Partial<RagEngineConfig>,
): RagEngineConfig {
  return { ...base, ...partial };
}
