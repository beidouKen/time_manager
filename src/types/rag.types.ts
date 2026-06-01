// ============================================================
// rag.types.ts — V3.8 RAG Foundation 数据契约
//
// 本期不依赖向量数据库；类型按业务语义命名（camelCase）。
// SQLite 列名仍使用 snake_case，在 Repository/Service 层做一次映射。
//
// 安全边界提醒：
// - RAG 不调用 ToolRouter，不写 tasks / time_blocks。
// - external_context 的 actionItems 永远是 candidate，必须走
//   Import Proposal -> 用户确认 -> ToolRouter，不允许短路。
// ============================================================

export type RagSourceType =
  | "seed_knowledge"
  | "external_context"
  | "user_material"
  | "memory_summary"
  | "system_guidance";

/**
 * V3.8.1：文档生命周期状态。
 *
 * - draft   ：刚创建/未审核，Agent 检索默认不可见。
 * - active  ：人工 review 后启用，可进入 retrieve。
 * - archived：已归档，不再返回；保留 row 用于追溯。
 */
export type RagStatus = "draft" | "active" | "archived";

/**
 * V3.8.1：文档可信度。当前仅用于排序展示，未来可参与 retrieve 加权。
 */
export type RagTrustLevel = "low" | "medium" | "high";

export interface RagDocument {
  id: string;
  sourceType: RagSourceType;
  title: string;
  summary?: string;
  sourceRef?: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  /** V3.8.1：生命周期，默认 draft；只有 active 进入默认检索。 */
  status: RagStatus;
  /** V3.8.1：可信度，默认 medium。 */
  trustLevel: RagTrustLevel;
  /** V3.8.1：人工 review/activate 的时间戳。 */
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 未来阶段保留字段（不在本轮 schema 引入，但类型层先开洞）：
   * - ownerId / workspaceId / visibility / embeddingModel / vectorIndexedAt
   * 这些是真正多用户/向量化阶段才落地的字段，本轮置空。
   */
}

export interface RagChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tags: string[];
  sourceRef?: string;
  metadata?: Record<string, unknown>;
  tokenCount?: number;
  createdAt: string;
}

/** 检索命中结果：在 RagChunk 基础上附加相关性分数与所属来源类型。 */
export interface RagChunkHit extends RagChunk {
  /** 0-1 相关性分数，由 ragRanking.scoreChunk 计算。 */
  score: number;
  /** 冗余来自所属 document，便于消费方直接读取。 */
  sourceType: RagSourceType;
}

/** ingest 时单个 chunk 的可选输入：tags / metadata 都可省。 */
export interface IngestChunkInput {
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface IngestDocumentInput {
  sourceType: RagSourceType;
  title: string;
  summary?: string;
  sourceRef?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /**
   * V3.8.1：可选 status，默认 'draft'。Policy 层可能覆写：
   * 例如 external_context 经 UI 写入时会被强制为 'draft'。
   */
  status?: RagStatus;
  /** V3.8.1：可选 trustLevel，默认 'medium'。 */
  trustLevel?: RagTrustLevel;
  /**
   * 二选一：
   * - chunks: 调用方已预切好的 chunk 列表（适合结构化来源）。
   * - fullText: 完整文本，由 RagService 内部调用 chunkText 自动切块。
   * 两者都不传时 RagService 会以 summary 作为单一 chunk。
   */
  chunks?: IngestChunkInput[];
  fullText?: string;
}

export interface RagQueryOptions {
  /** 按 sourceType 做硬过滤，只返回指定类型的 chunks。 */
  sourceTypes?: RagSourceType[];
  /**
   * 优先标签（score boost）。
   *
   * 语义说明：tags 仅参与相关性排序加权，**不作为访问控制或硬过滤条件**。
   * 不在此列表中的 chunk 仍会被检索和返回，只是得分相对较低。
   *
   * 真正的权限过滤应依赖 sourceType / owner_id / workspace_id / visibility
   * 等字段，这些属于后续阶段的实现，当前版本暂未引入。
   */
  tags?: string[];
  limit?: number;
  /**
   * V3.8.1：是否包含非 active 文档。
   * 默认 false，即只检索 status='active' AND deleted_at IS NULL 的文档；
   * 管理 UI 的列表/搜索可以传 true 来包含 draft / archived。
   */
  includeNonActive?: boolean;
}
