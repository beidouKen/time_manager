// ============================================================
// RagService.ts — V3.8 RAG 持久化与检索服务
//
// 职责：
// - ingestDocument(): 写入 rag_documents + rag_chunks（含自动 chunk）。
// - retrieve():       基于 keyword + tag + sourceType 的本地检索。
// - getDocument / listDocuments / deleteDocument：基础读写。
//
// 安全边界：
// - 不调用 ToolRouter，不写 tasks / time_blocks。
// - 不调用 LLM / 向量库 / 外部 fetch。
// - external_context 的 actionItems 由调用方保存到 metadata.actionItems，
//   不能在 ingest 阶段触发任何执行；必须由未来的 Import Proposal 流程
//   读取后引导用户确认才能进入 ToolRouter。
//
// 实现细节：
// - SQLite 列名使用 snake_case；类型层使用 camelCase。在本服务内做映射。
// - 检索使用 LIKE，单机数据量下可接受；接口稳定，后续替换 FTS5 / sqlite-vec。
// ============================================================

import { getDb } from "@/db/client";
import { chunkText, scoreChunk, tokenize } from "@/services/rag/ragRanking";
import type {
  IngestChunkInput,
  IngestDocumentInput,
  RagChunk,
  RagChunkHit,
  RagDocument,
  RagQueryOptions,
  RagSourceType,
  RagStatus,
  RagTrustLevel,
} from "@/types/rag.types";

interface DocumentRow {
  id: string;
  source_type: RagSourceType;
  title: string;
  summary: string | null;
  source_ref: string | null;
  tags_json: string;
  metadata_json: string | null;
  // V3.8.1 新增字段（旧数据可能为 null，由读路径做默认值兜底）
  status: RagStatus | null;
  trust_level: RagTrustLevel | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ChunkRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  tags_json: string;
  source_ref: string | null;
  metadata_json: string | null;
  token_count: number | null;
  created_at: string;
}

function rowToDocument(row: DocumentRow): RagDocument {
  return {
    id: row.id,
    sourceType: row.source_type,
    title: row.title,
    summary: row.summary ?? undefined,
    sourceRef: row.source_ref ?? undefined,
    tags: parseJsonArray(row.tags_json),
    metadata: parseJsonObject(row.metadata_json),
    status: row.status ?? "draft",
    trustLevel: row.trust_level ?? "medium",
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToChunk(row: ChunkRow): RagChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    tags: parseJsonArray(row.tags_json),
    sourceRef: row.source_ref ?? undefined,
    metadata: parseJsonObject(row.metadata_json),
    tokenCount: row.token_count ?? undefined,
    createdAt: row.created_at,
  };
}

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(
  json: string | null | undefined,
): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_LIMIT = 5;
const MAX_LIKE_ROWS = 200; // 单次检索拉回上限，避免在 v1 LIKE 扫表时无限增长

/** 数据库接口的最小形状，用于测试时注入 mock DB。 */
export interface RagDb {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

export class RagService {
  /** 测试可注入 mock DB；生产运行时为 undefined，使用 getDb() 懒获取。 */
  private readonly injectedDb: RagDb | undefined;

  constructor(db?: RagDb) {
    this.injectedDb = db;
  }

  private async db(): Promise<RagDb> {
    if (this.injectedDb) return this.injectedDb;
    return getDb() as Promise<RagDb>;
  }
  /**
   * 写入一篇文档及其 chunks，整体包裹在 SQLite 事务中。
   *
   * - 若 chunks 已提供则直接使用；否则用 chunkText(fullText) 自动切；
   *   两者都缺时以 summary 或 title 作为单一 chunk 兜底。
   * - document + chunks 写入任一失败时整体 ROLLBACK，不留半成品。
   * - 接口签名保持不变，调用方无感知。
   */
  async ingestDocument(input: IngestDocumentInput): Promise<RagDocument> {
    const db = await this.db();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const tags = input.tags ?? [];
    const metadata = input.metadata;
    const status: RagStatus = input.status ?? "draft";
    const trustLevel: RagTrustLevel = input.trustLevel ?? "medium";
    // 入库时如果直接是 active，则 reviewed_at 取 now；draft/archived 保持 null。
    const reviewedAt = status === "active" ? now : null;

    await db.execute("BEGIN", []);
    try {
      await db.execute(
        `INSERT INTO rag_documents
          (id, source_type, title, summary, source_ref, tags_json, metadata_json,
           status, trust_level, reviewed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          id,
          input.sourceType,
          input.title,
          input.summary ?? null,
          input.sourceRef ?? null,
          JSON.stringify(tags),
          metadata ? JSON.stringify(metadata) : null,
          status,
          trustLevel,
          reviewedAt,
          now,
        ],
      );

      const chunkContents = this.resolveChunkContents(input);
      for (let i = 0; i < chunkContents.length; i += 1) {
        const c = chunkContents[i];
        const chunkId = crypto.randomUUID();
        await db.execute(
          `INSERT INTO rag_chunks
            (id, document_id, chunk_index, content, tags_json, source_ref, metadata_json, token_count, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            chunkId,
            id,
            i,
            c.content,
            JSON.stringify(c.tags ?? tags),
            input.sourceRef ?? null,
            c.metadata ? JSON.stringify(c.metadata) : null,
            tokenize(c.content).length,
            now,
          ],
        );
      }

      await db.execute("COMMIT", []);
    } catch (err) {
      // 回滚事务，确保不留半成品文档
      try { await db.execute("ROLLBACK", []); } catch { /* 忽略 rollback 错误 */ }
      throw err;
    }

    return {
      id,
      sourceType: input.sourceType,
      title: input.title,
      summary: input.summary,
      sourceRef: input.sourceRef,
      tags,
      metadata,
      status,
      trustLevel,
      reviewedAt: reviewedAt ?? undefined,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 根据自然语言 query 检索相关 chunks。
   * 流程：tokenize → SQL LIKE 召回（按 sourceType / tags 过滤）→ 内存评分 → 取 top N。
   */
  async retrieve(
    query: string,
    opts: RagQueryOptions = {},
  ): Promise<RagChunkHit[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const db = await this.db();
    const limit = opts.limit ?? DEFAULT_LIMIT;

    const where: string[] = ["d.deleted_at IS NULL"];
    const params: unknown[] = [];

    // V3.8.1：默认只检索 active 文档。管理 UI 显式传 includeNonActive=true 才包含 draft/archived。
    if (!opts.includeNonActive) {
      where.push(`d.status = 'active'`);
    }

    if (opts.sourceTypes && opts.sourceTypes.length > 0) {
      const placeholders = opts.sourceTypes
        .map((_, i) => `$${params.length + i + 1}`)
        .join(", ");
      where.push(`d.source_type IN (${placeholders})`);
      params.push(...opts.sourceTypes);
    }

    // LIKE OR：任一 token 命中即召回
    const likeClauses: string[] = [];
    for (const t of tokens) {
      const idx = params.length + 1;
      likeClauses.push(`c.content LIKE $${idx}`);
      params.push(`%${t}%`);
    }
    if (likeClauses.length > 0) {
      where.push(`(${likeClauses.join(" OR ")})`);
    }

    const sql =
      `SELECT c.*, d.source_type AS doc_source_type
       FROM rag_chunks c
       JOIN rag_documents d ON d.id = c.document_id
       WHERE ${where.join(" AND ")}
       LIMIT ${MAX_LIKE_ROWS}`;

    const rows = await db.select<Array<ChunkRow & { doc_source_type: RagSourceType }>>(
      sql,
      params,
    );

    const hits: RagChunkHit[] = [];
    for (const row of rows) {
      const chunk = rowToChunk(row);
      const score = scoreChunk(chunk.content, chunk.tags, tokens, opts.tags);
      if (score <= 0) continue;
      hits.push({ ...chunk, score, sourceType: row.doc_source_type });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  async getDocument(id: string): Promise<RagDocument | null> {
    const db = await this.db();
    const rows = await db.select<DocumentRow[]>(
      "SELECT * FROM rag_documents WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    return rows[0] ? rowToDocument(rows[0]) : null;
  }

  async listDocuments(
    opts: {
      sourceType?: RagSourceType;
      /** V3.8.1：按 status 过滤；不传则不过滤（含 draft/active/archived 全部）。 */
      status?: RagStatus;
      /** V3.8.1：标题/摘要模糊搜索（SQL LIKE）。 */
      search?: string;
      /** V3.8.1：包含软删的文档（默认排除）。 */
      includeDeleted?: boolean;
      limit?: number;
    } = {},
  ): Promise<RagDocument[]> {
    const db = await this.db();
    const params: unknown[] = [];
    const where: string[] = [];
    if (!opts.includeDeleted) where.push("deleted_at IS NULL");
    if (opts.sourceType) {
      params.push(opts.sourceType);
      where.push(`source_type = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`status = $${params.length}`);
    }
    if (opts.search && opts.search.trim()) {
      const kw = `%${opts.search.trim()}%`;
      params.push(kw, kw);
      where.push(`(title LIKE $${params.length - 1} OR summary LIKE $${params.length})`);
    }
    let sql = "SELECT * FROM rag_documents";
    if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
    sql += " ORDER BY updated_at DESC, created_at DESC";
    if (opts.limit && opts.limit > 0) {
      sql += ` LIMIT ${Math.floor(opts.limit)}`;
    }
    const rows = await db.select<DocumentRow[]>(sql, params);
    return rows.map(rowToDocument);
  }

  async deleteDocument(id: string): Promise<void> {
    const db = await this.db();
    // ON DELETE CASCADE 会同时清掉 chunks。这里软删 document，保留追溯。
    await db.execute(
      "UPDATE rag_documents SET deleted_at = $1, updated_at = $1 WHERE id = $2",
      [new Date().toISOString(), id],
    );
  }

  /**
   * V3.8.1：把文档置为 active，并写 reviewed_at。
   * 仅做 SQL 更新，不做 Policy 校验；调用方应使用 RagIngestionService。
   */
  async activateDocument(id: string): Promise<void> {
    const db = await this.db();
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE rag_documents
          SET status = 'active', reviewed_at = $1, updated_at = $1
        WHERE id = $2 AND deleted_at IS NULL`,
      [now, id],
    );
  }

  /**
   * V3.8.1：把文档置为 archived。被归档的文档不再进入默认 retrieve。
   */
  async archiveDocument(id: string): Promise<void> {
    const db = await this.db();
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE rag_documents
          SET status = 'archived', updated_at = $1
        WHERE id = $2 AND deleted_at IS NULL`,
      [now, id],
    );
  }

  /**
   * V3.8.1：通用补丁式更新。仅允许更新可见元数据字段，不允许改 sourceType/id。
   * chunks 暂不通过此方法更新（避免与 ingest 流程混用）。
   */
  async updateDocument(
    id: string,
    patch: Partial<{
      title: string;
      summary: string | null;
      sourceRef: string | null;
      tags: string[];
      metadata: Record<string, unknown> | null;
      trustLevel: RagTrustLevel;
    }>,
  ): Promise<void> {
    const db = await this.db();
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) {
      params.push(patch.title);
      sets.push(`title = $${params.length}`);
    }
    if (patch.summary !== undefined) {
      params.push(patch.summary);
      sets.push(`summary = $${params.length}`);
    }
    if (patch.sourceRef !== undefined) {
      params.push(patch.sourceRef);
      sets.push(`source_ref = $${params.length}`);
    }
    if (patch.tags !== undefined) {
      params.push(JSON.stringify(patch.tags));
      sets.push(`tags_json = $${params.length}`);
    }
    if (patch.metadata !== undefined) {
      params.push(patch.metadata ? JSON.stringify(patch.metadata) : null);
      sets.push(`metadata_json = $${params.length}`);
    }
    if (patch.trustLevel !== undefined) {
      params.push(patch.trustLevel);
      sets.push(`trust_level = $${params.length}`);
    }
    if (sets.length === 0) return;
    params.push(new Date().toISOString());
    sets.push(`updated_at = $${params.length}`);
    params.push(id);
    await db.execute(
      `UPDATE rag_documents SET ${sets.join(", ")} WHERE id = $${params.length} AND deleted_at IS NULL`,
      params,
    );
  }

  /**
   * 供 seed / 测试使用：根据 title + sourceType 查找文档。
   * 用于幂等写入判断。
   */
  async findDocumentByTitle(
    sourceType: RagSourceType,
    title: string,
  ): Promise<RagDocument | null> {
    const db = await this.db();
    const rows = await db.select<DocumentRow[]>(
      `SELECT * FROM rag_documents
       WHERE source_type = $1 AND title = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [sourceType, title],
    );
    return rows[0] ? rowToDocument(rows[0]) : null;
  }

  /** V3.8.2：统计 rag_chunks 总行数（Demo Library stats）。 */
  async countChunks(): Promise<number> {
    const db = await this.db();
    const rows = await db.select<Array<{ cnt: number }>>(
      "SELECT COUNT(*) as cnt FROM rag_chunks",
      [],
    );
    return Number(rows[0]?.cnt) || 0;
  }

  /** V3.8.2：按 document_id 列出 chunks，按 chunk_index 升序（用于导出拼合正文）。 */
  async listChunksForDocument(documentId: string): Promise<RagChunk[]> {
    const db = await this.db();
    const rows = await db.select<ChunkRow[]>(
      `SELECT * FROM rag_chunks
       WHERE document_id = $1
       ORDER BY chunk_index ASC`,
      [documentId],
    );
    return rows.map(rowToChunk);
  }

  /**
   * V3.8.3：列出 active 且未软删文档下的全部 chunks（供 embed / vector 检索基线）。
   * sourceTypes 非空时做硬过滤。
   */
  async listChunksForActiveDocuments(
    sourceTypes?: RagSourceType[],
  ): Promise<RagChunk[]> {
    const db = await this.db();
    const where: string[] = [
      "d.deleted_at IS NULL",
      "d.status = 'active'",
    ];
    const params: unknown[] = [];
    if (sourceTypes && sourceTypes.length > 0) {
      const placeholders = sourceTypes
        .map((_, i) => `$${i + 1}`)
        .join(", ");
      where.push(`d.source_type IN (${placeholders})`);
      params.push(...sourceTypes);
    }
    const rows = await db.select<ChunkRow[]>(
      `SELECT c.*
         FROM rag_chunks c
         JOIN rag_documents d ON d.id = c.document_id
        WHERE ${where.join(" AND ")}
        ORDER BY c.document_id, c.chunk_index`,
      params,
    );
    return rows.map(rowToChunk);
  }

  /**
   * V3.8.5：按 chunk id 拉取 chunk + 文档 sourceType（Hybrid 向量通道 hydration）。
   */
  async getChunksWithDocByIds(
    chunkIds: string[],
    opts: {
      sourceTypes?: RagSourceType[];
      includeNonActive?: boolean;
    } = {},
  ): Promise<
    Array<
      RagChunk & {
        sourceType: RagSourceType;
      }
    >
  > {
    if (chunkIds.length === 0) return [];
    const db = await this.db();
    const placeholders = chunkIds.map((_, i) => `$${i + 1}`).join(", ");
    const params: unknown[] = [...chunkIds];
    const where: string[] = ["d.deleted_at IS NULL", `c.id IN (${placeholders})`];

    if (!opts.includeNonActive) {
      where.push("d.status = 'active'");
    }
    if (opts.sourceTypes && opts.sourceTypes.length > 0) {
      const st = opts.sourceTypes
        .map((_, i) => `$${params.length + i + 1}`)
        .join(", ");
      where.push(`d.source_type IN (${st})`);
      params.push(...opts.sourceTypes);
    }

    const rows = await db.select<
      Array<ChunkRow & { doc_source_type: RagSourceType }>
    >(
      `SELECT c.*, d.source_type AS doc_source_type
         FROM rag_chunks c
         JOIN rag_documents d ON d.id = c.document_id
        WHERE ${where.join(" AND ")}`,
      params,
    );

    return rows.map((row) => ({
      ...rowToChunk(row),
      sourceType: row.doc_source_type,
    }));
  }

  /** V3.8.5：按 document id 查标题（评测用）。 */
  async getDocumentTitle(documentId: string): Promise<string | null> {
    const doc = await this.getDocument(documentId);
    return doc?.title ?? null;
  }

  /**
   * V3.8.3：删除某文档在指定 model/version 下的全部 embeddings（refresh 前清理）。
   */
  async deleteEmbeddingsForDocument(
    documentId: string,
    embeddingModel: string,
    embeddingVersion: string,
  ): Promise<void> {
    const db = await this.db();
    await db.execute(
      `DELETE FROM rag_embeddings
        WHERE document_id = $1
          AND embedding_model = $2
          AND embedding_version = $3`,
      [documentId, embeddingModel, embeddingVersion],
    );
  }

  private resolveChunkContents(
    input: IngestDocumentInput,
  ): IngestChunkInput[] {
    if (input.chunks && input.chunks.length > 0) {
      return input.chunks
        .filter((c) => c.content && c.content.trim())
        .map((c) => ({
          content: c.content.trim(),
          tags: c.tags,
          metadata: c.metadata,
        }));
    }
    if (input.fullText && input.fullText.trim()) {
      const pieces = chunkText(input.fullText);
      if (pieces.length > 0) {
        return pieces.map((content) => ({ content }));
      }
    }
    const fallback = (input.summary ?? input.title).trim();
    return fallback ? [{ content: fallback }] : [];
  }
}
