// ============================================================
// VectorRagService.ts — V3.8.3 最小本地向量 RAG
//
// V3.8.4 路线：本类作为 LocalVectorRagService / dev fallback 保留；
// 不重命名为避免 import 雪崩。生产 RAG 将走 VectorStore + HybridRetriever 栈。
//
// - embedMissingChunks / retrieveVector / retrieveHybrid
// - DeterministicEmbeddingProvider 默认；不调用 ToolRouter / 外部 Coze
// ============================================================

import { cosineSimilarity } from "@/services/rag/embedding/cosineSimilarity";
import { createDefaultEmbeddingProvider } from "@/services/rag/embedding/embeddingProviderFactory";
import type { EmbeddingProvider } from "@/services/rag/embedding/EmbeddingProvider";
import { getDb } from "@/db/client";
import type { RagDb } from "@/services/rag/RagService";
import { RagService } from "@/services/rag/RagService";
import type {
  EmbeddingVector,
  RagSourceType,
  VectorRagChunkHit,
  VectorRetrieveOptions,
} from "@/types/rag.types";

interface ChunkWithDocRow {
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

function parseVector(json: string): EmbeddingVector {
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is number => typeof x === "number");
  } catch {
    return [];
  }
}

function rowToChunkHit(
  row: ChunkWithDocRow,
  score: number,
  retrieveMode: "vector" | "keyword",
): VectorRagChunkHit {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags_json);
    tags = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    tags,
    sourceRef: row.source_ref ?? undefined,
    tokenCount: row.token_count ?? undefined,
    createdAt: row.created_at,
    score,
    sourceType: row.doc_source_type,
    retrieveMode,
  };
}

export class VectorRagService {
  private readonly rag: RagService;
  private readonly provider: EmbeddingProvider;
  private readonly injectedDb: RagDb | undefined;

  constructor(
    rag?: RagService,
    provider: EmbeddingProvider = createDefaultEmbeddingProvider(),
    db?: RagDb,
  ) {
    this.injectedDb = db;
    this.rag = rag ?? new RagService(db);
    this.provider = provider;
  }

  private async db(): Promise<RagDb> {
    if (this.injectedDb) return this.injectedDb;
    return getDb() as Promise<RagDb>;
  }

  async embedChunk(chunkId: string): Promise<void> {
    const db = await this.db();
    const rows = await db.select<ChunkWithDocRow[]>(
      `SELECT c.*, d.source_type AS doc_source_type
         FROM rag_chunks c
         JOIN rag_documents d ON d.id = c.document_id
        WHERE c.id = $1
          AND d.deleted_at IS NULL
          AND d.status = 'active'`,
      [chunkId],
    );
    const row = rows[0];
    if (!row) return;

    const vec = await this.provider.embed(row.content);
    await this.upsertEmbedding(row.id, row.document_id, vec);
  }

  async embedDocument(
    documentId: string,
  ): Promise<{ embedded: number; skipped: number }> {
    const db = await this.db();
    const docRows = await db.select<Array<{ status: string; deleted_at: string | null }>>(
      `SELECT status, deleted_at FROM rag_documents WHERE id = $1`,
      [documentId],
    );
    const doc = docRows[0];
    if (!doc || doc.deleted_at || doc.status !== "active") {
      return { embedded: 0, skipped: 0 };
    }

    const chunks = await this.rag.listChunksForDocument(documentId);
    let embedded = 0;
    let skipped = 0;
    for (const c of chunks) {
      const exists = await this.hasEmbedding(c.id);
      if (exists) {
        skipped += 1;
        continue;
      }
      const vec = await this.provider.embed(c.content);
      await this.upsertEmbedding(c.id, documentId, vec);
      embedded += 1;
    }
    return { embedded, skipped };
  }

  async embedMissingChunks(
    opts: { sourceTypes?: RagSourceType[] } = {},
  ): Promise<{ embedded: number; total: number }> {
    const db = await this.db();
    const where: string[] = [
      "d.deleted_at IS NULL",
      "d.status = 'active'",
    ];
    const params: unknown[] = [
      this.provider.model,
      this.provider.version,
    ];
    if (opts.sourceTypes && opts.sourceTypes.length > 0) {
      const placeholders = opts.sourceTypes
        .map((_, i) => `$${params.length + i + 1}`)
        .join(", ");
      where.push(`d.source_type IN (${placeholders})`);
      params.push(...opts.sourceTypes);
    }

    const rows = await db.select<ChunkWithDocRow[]>(
      `SELECT c.*, d.source_type AS doc_source_type
         FROM rag_chunks c
         JOIN rag_documents d ON d.id = c.document_id
        WHERE ${where.join(" AND ")}
          AND NOT EXISTS (
            SELECT 1 FROM rag_embeddings e
             WHERE e.chunk_id = c.id
               AND e.embedding_model = $1
               AND e.embedding_version = $2
          )
        ORDER BY c.document_id, c.chunk_index`,
      params,
    );

    if (rows.length === 0) {
      return { embedded: 0, total: 0 };
    }

    const texts = rows.map((r) => r.content);
    const vectors = await this.provider.embedBatch(texts);

    await db.execute("BEGIN", []);
    try {
      for (let i = 0; i < rows.length; i += 1) {
        await this.upsertEmbeddingInTx(
          db,
          rows[i].id,
          rows[i].document_id,
          vectors[i],
        );
      }
      await db.execute("COMMIT", []);
    } catch (err) {
      try {
        await db.execute("ROLLBACK", []);
      } catch {
        /* ignore */
      }
      throw err;
    }

    return { embedded: rows.length, total: rows.length };
  }

  async refreshEmbeddingForDocument(documentId: string): Promise<void> {
    await this.rag.deleteEmbeddingsForDocument(
      documentId,
      this.provider.model,
      this.provider.version,
    );
    await this.embedDocument(documentId);
  }

  async retrieveVector(
    query: string,
    opts: VectorRetrieveOptions = {},
  ): Promise<VectorRagChunkHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const queryVec = await this.provider.embed(trimmed);
    const db = await this.db();
    const limit = opts.limit ?? DEFAULT_LIMIT;

    const where: string[] = [
      "d.deleted_at IS NULL",
      "e.embedding_model = $1",
      "e.embedding_version = $2",
    ];
    const params: unknown[] = [
      this.provider.model,
      this.provider.version,
    ];

    if (!opts.includeNonActive) {
      where.push("d.status = 'active'");
    }

    if (opts.sourceTypes && opts.sourceTypes.length > 0) {
      const placeholders = opts.sourceTypes
        .map((_, i) => `$${params.length + i + 1}`)
        .join(", ");
      where.push(`d.source_type IN (${placeholders})`);
      params.push(...opts.sourceTypes);
    }

    const rows = await db.select<Array<ChunkWithDocRow & { vector_json: string }>>(
      `SELECT c.*, d.source_type AS doc_source_type, e.vector_json
         FROM rag_embeddings e
         JOIN rag_chunks c ON c.id = e.chunk_id
         JOIN rag_documents d ON d.id = c.document_id
        WHERE ${where.join(" AND ")}`,
      params,
    );

    const scored: VectorRagChunkHit[] = [];
    for (const row of rows) {
      const vec = parseVector(row.vector_json);
      const score = cosineSimilarity(queryVec, vec);
      if (score <= 0) continue;
      scored.push(rowToChunkHit(row, score, "vector"));
    }

    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return scored.slice(0, limit);
  }

  async retrieveHybrid(
    query: string,
    opts: VectorRetrieveOptions = {},
  ): Promise<VectorRagChunkHit[]> {
    const vectorHits = await this.retrieveVector(query, opts);
    if (vectorHits.length >= 1) return vectorHits;

    const keywordHits = await this.rag.retrieve(query, {
      sourceTypes: opts.sourceTypes,
      limit: opts.limit,
      includeNonActive: opts.includeNonActive,
    });

    return keywordHits.map((h) => ({
      ...h,
      retrieveMode: "keyword" as const,
    }));
  }

  private async hasEmbedding(chunkId: string): Promise<boolean> {
    const db = await this.db();
    const rows = await db.select<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt FROM rag_embeddings
        WHERE chunk_id = $1
          AND embedding_model = $2
          AND embedding_version = $3`,
      [chunkId, this.provider.model, this.provider.version],
    );
    return Number(rows[0]?.cnt) > 0;
  }

  private async upsertEmbedding(
    chunkId: string,
    documentId: string,
    vector: EmbeddingVector,
  ): Promise<void> {
    const db = await this.db();
    await this.upsertEmbeddingInTx(db, chunkId, documentId, vector);
  }

  private async upsertEmbeddingInTx(
    db: RagDb,
    chunkId: string,
    documentId: string,
    vector: EmbeddingVector,
  ): Promise<void> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const vectorJson = JSON.stringify(vector);
    const dims = vector.length;

    try {
      await db.execute(
        `INSERT INTO rag_embeddings
          (id, chunk_id, document_id, embedding_model, embedding_version,
           vector_json, dimensions, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          id,
          chunkId,
          documentId,
          this.provider.model,
          this.provider.version,
          vectorJson,
          dims,
          now,
        ],
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("UNIQUE") ||
        msg.includes("unique") ||
        msg.includes("constraint")
      ) {
        await db.execute(
          `UPDATE rag_embeddings
              SET vector_json = $1, dimensions = $2, updated_at = $3
            WHERE chunk_id = $4
              AND embedding_model = $5
              AND embedding_version = $6`,
          [
            vectorJson,
            dims,
            now,
            chunkId,
            this.provider.model,
            this.provider.version,
          ],
        );
        return;
      }
      throw err;
    }
  }
}
