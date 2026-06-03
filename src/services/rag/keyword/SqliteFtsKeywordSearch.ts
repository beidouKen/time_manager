// ============================================================
// SqliteFtsKeywordSearch.ts — V3.8.5 SQLite FTS5 关键词检索
//
// FTS 失败时 fallback RagService.retrieve（LIKE），不阻塞主路径。
// ============================================================

import { getDb } from "@/db/client";
import type { RagDb } from "@/services/rag/RagService";
import { RagService } from "@/services/rag/RagService";
import type {
  KeywordSearch,
  KeywordSearchHealth,
  KeywordSearchOptions,
} from "@/services/rag/keyword/KeywordSearch";
import type { RagSourceType, VectorRagChunkHit } from "@/types/rag.types";

interface FtsRow {
  chunk_id: string;
  document_id: string;
  bm25: number;
}

interface ChunkDocRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  tags_json: string;
  source_ref: string | null;
  metadata_json: string | null;
  token_count: number | null;
  created_at: string;
  doc_source_type: RagSourceType;
}

const DEFAULT_LIMIT = 5;

function escapeFtsQuery(q: string): string {
  const tokens = q
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/["']/g, ""));
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"`).join(" ");
}

function parseTags(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function rowToHit(row: ChunkDocRow, score: number): VectorRagChunkHit {
  return {
    id: row.id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    tags: parseTags(row.tags_json),
    sourceRef: row.source_ref ?? undefined,
    tokenCount: row.token_count ?? undefined,
    createdAt: row.created_at,
    score,
    sourceType: row.doc_source_type,
    retrieveMode: "keyword",
    retrievalSources: ["keyword"],
  };
}

function normalizeBm25(raw: number): number {
  // bm25 越小越好（负值）；映射到 (0,1]
  const s = 1 / (1 + Math.max(0, -raw));
  return Math.min(1, Math.max(0.01, s));
}

export class SqliteFtsKeywordSearch implements KeywordSearch {
  private readonly rag: RagService;
  private readonly injectedDb: RagDb | undefined;
  private ftsAvailable = true;

  constructor(rag?: RagService, db?: RagDb) {
    this.injectedDb = db;
    this.rag = rag ?? new RagService(db);
  }

  private async db(): Promise<RagDb> {
    if (this.injectedDb) return this.injectedDb;
    return getDb() as Promise<RagDb>;
  }

  async healthCheck(): Promise<KeywordSearchHealth> {
    if (!this.ftsAvailable) {
      return { ok: true, backend: "like-fallback" };
    }
    try {
      const db = await this.db();
      await db.select("SELECT 1 FROM rag_chunks_fts LIMIT 1", []);
      return { ok: true, backend: "sqlite-fts5" };
    } catch {
      this.ftsAvailable = false;
      return { ok: true, backend: "like-fallback" };
    }
  }

  async rebuildIndex(): Promise<void> {
    if (!this.ftsAvailable) return;
    const db = await this.db();
    try {
      await db.execute("BEGIN", []);
      await db.execute("DELETE FROM rag_chunks_fts", []);
      await db.execute(
        `INSERT INTO rag_chunks_fts(rowid, content, chunk_id, document_id)
         SELECT rowid, content, id, document_id FROM rag_chunks`,
        [],
      );
      await db.execute("COMMIT", []);
    } catch (e) {
      try {
        await db.execute("ROLLBACK", []);
      } catch {
        /* ignore */
      }
      this.ftsAvailable = false;
      console.warn("[SqliteFtsKeywordSearch] rebuildIndex failed, FTS disabled:", e);
    }
  }

  async search(
    query: string,
    opts: KeywordSearchOptions = {},
  ): Promise<VectorRagChunkHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    if (!this.ftsAvailable) {
      return this.fallbackRetrieve(trimmed, opts);
    }

    try {
      const hits = await this.searchFts(trimmed, opts);
      if (hits.length > 0) return hits;
      return this.fallbackRetrieve(trimmed, opts);
    } catch {
      this.ftsAvailable = false;
      return this.fallbackRetrieve(trimmed, opts);
    }
  }

  private async searchFts(
    query: string,
    opts: KeywordSearchOptions,
  ): Promise<VectorRagChunkHit[]> {
    const db = await this.db();
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const ftsQ = escapeFtsQuery(query);
    if (!ftsQ) return [];

    const where: string[] = ["d.deleted_at IS NULL"];

    if (!opts.includeNonActive) {
      where.push("d.status = 'active'");
    }

    const ftsRows = await db.select<FtsRow[]>(
      `SELECT f.chunk_id, f.document_id, bm25(rag_chunks_fts) AS bm25
         FROM rag_chunks_fts f
        WHERE rag_chunks_fts MATCH $1
        ORDER BY bm25
        LIMIT ${Math.min(limit * 4, 50)}`,
      [ftsQ],
    );

    if (ftsRows.length === 0) return [];

    const chunkIds = ftsRows.map((r) => r.chunk_id);
    const placeholders = chunkIds.map((_, i) => `$${i + 1}`).join(", ");
    const filterParams: unknown[] = [...chunkIds];

    if (opts.sourceTypes && opts.sourceTypes.length > 0) {
      const stPlaceholders = opts.sourceTypes
        .map((_, i) => `$${filterParams.length + i + 1}`)
        .join(", ");
      where.push(`d.source_type IN (${stPlaceholders})`);
      filterParams.push(...opts.sourceTypes);
    }

    const rows = await db.select<ChunkDocRow[]>(
      `SELECT c.*, d.source_type AS doc_source_type
         FROM rag_chunks c
         JOIN rag_documents d ON d.id = c.document_id
        WHERE c.id IN (${placeholders})
          AND ${where.join(" AND ")}`,
      filterParams,
    );

    const bm25ByChunk = new Map(ftsRows.map((r) => [r.chunk_id, r.bm25]));
    const hits: VectorRagChunkHit[] = [];
    for (const row of rows) {
      const raw = bm25ByChunk.get(row.id) ?? 0;
      hits.push(rowToHit(row, normalizeBm25(raw)));
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  private async fallbackRetrieve(
    query: string,
    opts: KeywordSearchOptions,
  ): Promise<VectorRagChunkHit[]> {
    const keywordHits = await this.rag.retrieve(query, {
      sourceTypes: opts.sourceTypes,
      limit: opts.limit ?? DEFAULT_LIMIT,
      includeNonActive: opts.includeNonActive,
    });
    return keywordHits.map((h) => ({
      ...h,
      retrieveMode: "keyword" as const,
      retrievalSources: ["keyword" as const],
    }));
  }
}
