// ============================================================
// SqliteVectorStore.ts — V3.8.5 本地 VectorStore（rag_embeddings + 内存 cosine）
// ============================================================

import { cosineSimilarity } from "@/services/rag/embedding/cosineSimilarity";
import type { EmbeddingProvider } from "@/services/rag/embedding/EmbeddingProvider";
import { getDb } from "@/db/client";
import type { RagDb } from "@/services/rag/RagService";
import type { RagSourceType } from "@/types/rag.types";
import type {
  VectorStore,
  VectorStoreHealth,
  VectorStoreHit,
  VectorStoreQueryOptions,
  VectorStoreUpsertItem,
} from "@/services/rag/vector/VectorStore";

interface ChunkDocRow {
  id: string;
  document_id: string;
  vector_json: string;
  doc_source_type: RagSourceType;
}

const DEFAULT_TOP_K = 5;

function parseVector(json: string): number[] {
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is number => typeof x === "number");
  } catch {
    return [];
  }
}

export class SqliteVectorStore implements VectorStore {
  private readonly provider: EmbeddingProvider;
  private readonly injectedDb: RagDb | undefined;

  constructor(provider: EmbeddingProvider, db?: RagDb) {
    this.provider = provider;
    this.injectedDb = db;
  }

  private async db(): Promise<RagDb> {
    if (this.injectedDb) return this.injectedDb;
    return getDb() as Promise<RagDb>;
  }

  async healthCheck(): Promise<VectorStoreHealth> {
    return { ok: true, backend: "sqlite-vector-json" };
  }

  async upsert(items: VectorStoreUpsertItem[]): Promise<void> {
    if (items.length === 0) return;
    const db = await this.db();
    const now = new Date().toISOString();
    await db.execute("BEGIN", []);
    try {
      for (const item of items) {
        const id = crypto.randomUUID();
        const vectorJson = JSON.stringify(item.vector);
        try {
          await db.execute(
            `INSERT INTO rag_embeddings
              (id, chunk_id, document_id, embedding_model, embedding_version,
               vector_json, dimensions, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
            [
              id,
              item.chunkId,
              item.documentId,
              item.embeddingModel,
              item.embeddingVersion,
              vectorJson,
              item.dimensions,
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
                item.dimensions,
                now,
                item.chunkId,
                item.embeddingModel,
                item.embeddingVersion,
              ],
            );
          } else {
            throw err;
          }
        }
      }
      await db.execute("COMMIT", []);
    } catch (e) {
      try {
        await db.execute("ROLLBACK", []);
      } catch {
        /* ignore */
      }
      throw e;
    }
  }

  async query(vec: number[], opts: VectorStoreQueryOptions = {}): Promise<VectorStoreHit[]> {
    const db = await this.db();
    const topK = opts.topK ?? DEFAULT_TOP_K;

    const where: string[] = [
      "d.deleted_at IS NULL",
      "e.embedding_model = $1",
      "e.embedding_version = $2",
    ];
    const params: unknown[] = [this.provider.model, this.provider.version];

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

    const rows = await db.select<ChunkDocRow[]>(
      `SELECT c.id, c.document_id, e.vector_json, d.source_type AS doc_source_type
         FROM rag_embeddings e
         JOIN rag_chunks c ON c.id = e.chunk_id
         JOIN rag_documents d ON d.id = c.document_id
        WHERE ${where.join(" AND ")}`,
      params,
    );

    const scored: VectorStoreHit[] = [];
    for (const row of rows) {
      const stored = parseVector(row.vector_json);
      const score = cosineSimilarity(vec, stored);
      if (score <= 0) continue;
      scored.push({
        chunkId: row.id,
        documentId: row.document_id,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
    return scored.slice(0, topK);
  }

  async deleteByDocument(
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

  async countEmbeddings(
    embeddingModel?: string,
    embeddingVersion?: string,
  ): Promise<number> {
    const db = await this.db();
    const model = embeddingModel ?? this.provider.model;
    const version = embeddingVersion ?? this.provider.version;
    const rows = await db.select<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt FROM rag_embeddings
        WHERE embedding_model = $1 AND embedding_version = $2`,
      [model, version],
    );
    return rows[0]?.cnt ?? 0;
  }

  async listIndexedDocumentIds(
    embeddingModel?: string,
    embeddingVersion?: string,
  ): Promise<string[]> {
    const db = await this.db();
    const model = embeddingModel ?? this.provider.model;
    const version = embeddingVersion ?? this.provider.version;
    const rows = await db.select<Array<{ document_id: string }>>(
      `SELECT DISTINCT document_id FROM rag_embeddings
        WHERE embedding_model = $1 AND embedding_version = $2`,
      [model, version],
    );
    return rows.map((r) => r.document_id);
  }

  async clearModel(embeddingModel: string, embeddingVersion: string): Promise<number> {
    const db = await this.db();
    const before = await this.countEmbeddings(embeddingModel, embeddingVersion);
    await db.execute(
      `DELETE FROM rag_embeddings
        WHERE embedding_model = $1 AND embedding_version = $2`,
      [embeddingModel, embeddingVersion],
    );
    return before;
  }
}
