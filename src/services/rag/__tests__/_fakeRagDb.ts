// 共享内存假 DB，供 RAG 相关单测注入 RagService / VectorRagService。

import type { RagDb } from "@/services/rag/RagService";
import type { RagSourceType, RagStatus } from "@/types/rag.types";

export interface FakeDocRow {
  id: string;
  source_type: RagSourceType;
  title: string;
  summary: string | null;
  source_ref: string | null;
  tags_json: string;
  metadata_json: string | null;
  status: RagStatus;
  trust_level: "low" | "medium" | "high";
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FakeChunkRow {
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

export interface FakeEmbeddingRow {
  id: string;
  chunk_id: string;
  document_id: string;
  embedding_model: string;
  embedding_version: string;
  vector_json: string;
  dimensions: number;
  created_at: string;
  updated_at: string;
}

function activeChunks(
  docs: FakeDocRow[],
  chunks: FakeChunkRow[],
  sourceTypes?: RagSourceType[],
): FakeChunkRow[] {
  return chunks.filter((c) => {
    const doc = docs.find((d) => d.id === c.document_id);
    if (!doc || doc.deleted_at || doc.status !== "active") return false;
    if (sourceTypes?.length && !sourceTypes.includes(doc.source_type)) {
      return false;
    }
    return true;
  });
}

interface FakeFtsRow {
  rowid: number;
  content: string;
  chunk_id: string;
  document_id: string;
}

export function buildFakeDb(): RagDb & {
  docs: FakeDocRow[];
  chunks: FakeChunkRow[];
  embeddings: FakeEmbeddingRow[];
  ftsRows: FakeFtsRow[];
} {
  const docs: FakeDocRow[] = [];
  const chunks: FakeChunkRow[] = [];
  const embeddings: FakeEmbeddingRow[] = [];
  const ftsRows: FakeFtsRow[] = [];

  const db: RagDb & {
    docs: FakeDocRow[];
    chunks: FakeChunkRow[];
    embeddings: FakeEmbeddingRow[];
    ftsRows: FakeFtsRow[];
  } = {
    docs,
    chunks,
    embeddings,
    ftsRows,

    async execute(sql: string, params: unknown[] = []) {
      const s = sql.trim().toUpperCase();

      if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
        return {};
      }

      if (s.startsWith("INSERT INTO RAG_DOCUMENTS")) {
        const [
          id, sourceType, title, summary, sourceRef, tagsJson,
          metadataJson, status, trustLevel, reviewedAt, createdAt,
        ] = params as [
          string, RagSourceType, string, string | null, string | null, string,
          string | null, RagStatus, "low" | "medium" | "high", string | null, string,
        ];
        docs.push({
          id,
          source_type: sourceType,
          title,
          summary,
          source_ref: sourceRef,
          tags_json: tagsJson,
          metadata_json: metadataJson,
          status,
          trust_level: trustLevel,
          reviewed_at: reviewedAt,
          created_at: createdAt,
          updated_at: createdAt,
          deleted_at: null,
        });
        return {};
      }

      if (s.startsWith("INSERT INTO RAG_CHUNKS")) {
        const [
          id, documentId, chunkIndex, content, tagsJson, sourceRef,
          metadataJson, tokenCount, createdAt,
        ] = params as [
          string, string, number, string, string, string | null,
          string | null, number | null, string,
        ];
        chunks.push({
          id,
          document_id: documentId,
          chunk_index: chunkIndex,
          content,
          tags_json: tagsJson,
          source_ref: sourceRef,
          metadata_json: metadataJson,
          token_count: tokenCount,
          created_at: createdAt,
        });
        return {};
      }

      if (s.startsWith("INSERT INTO RAG_EMBEDDINGS")) {
        const [
          id, chunkId, documentId, model, version, vectorJson, dimensions, createdAt,
        ] = params as [
          string, string, string, string, string, string, number, string,
        ];
        const dup = embeddings.find(
          (e) =>
            e.chunk_id === chunkId &&
            e.embedding_model === model &&
            e.embedding_version === version,
        );
        if (dup) {
          throw new Error("UNIQUE constraint failed: uniq_rag_embeddings_chunk_model");
        }
        embeddings.push({
          id,
          chunk_id: chunkId,
          document_id: documentId,
          embedding_model: model,
          embedding_version: version,
          vector_json: vectorJson,
          dimensions: dimensions,
          created_at: createdAt,
          updated_at: createdAt,
        });
        return {};
      }

      if (s.startsWith("UPDATE RAG_EMBEDDINGS")) {
        const [vectorJson, dimensions, updatedAt, chunkId, model, version] = params as [
          string, number, string, string, string, string,
        ];
        const row = embeddings.find(
          (e) =>
            e.chunk_id === chunkId &&
            e.embedding_model === model &&
            e.embedding_version === version,
        );
        if (row) {
          row.vector_json = vectorJson;
          row.dimensions = dimensions;
          row.updated_at = updatedAt;
        }
        return {};
      }

      if (s.startsWith("DELETE FROM RAG_EMBEDDINGS")) {
        const [documentId, model, version] = params as [string, string, string];
        for (let i = embeddings.length - 1; i >= 0; i -= 1) {
          const e = embeddings[i];
          if (
            e.document_id === documentId &&
            e.embedding_model === model &&
            e.embedding_version === version
          ) {
            embeddings.splice(i, 1);
          }
        }
        return {};
      }

      if (s.startsWith("DELETE FROM RAG_CHUNKS_FTS")) {
        ftsRows.length = 0;
        return {};
      }

      if (s.startsWith("INSERT INTO RAG_CHUNKS_FTS")) {
        let rowid = 1;
        for (const c of chunks) {
          ftsRows.push({
            rowid: rowid++,
            content: c.content,
            chunk_id: c.id,
            document_id: c.document_id,
          });
        }
        return {};
      }

      if (s.startsWith("UPDATE RAG_DOCUMENTS")) {
        const lastId = params[params.length - 1] as string;
        const target = docs.find((d) => d.id === lastId && d.deleted_at === null);
        if (!target) return {};
        if (s.includes("STATUS = 'ACTIVE'")) {
          target.status = "active";
          target.reviewed_at = params[0] as string;
          target.updated_at = params[0] as string;
        } else if (s.includes("STATUS = 'ARCHIVED'")) {
          target.status = "archived";
          target.updated_at = params[0] as string;
        } else if (s.includes("DELETED_AT") && s.includes("UPDATED_AT")) {
          target.deleted_at = params[0] as string;
          target.updated_at = params[0] as string;
        }
        return {};
      }

      return {};
    },

    async select<T>(sql: string, params: unknown[] = []): Promise<T> {
      const s = sql.trim().toUpperCase();

      if (s.startsWith("SELECT COUNT(*)") && s.includes("RAG_EMBEDDINGS")) {
        const [chunkId, model, version] = params as [string, string, string];
        const cnt = embeddings.filter(
          (e) =>
            e.chunk_id === chunkId &&
            e.embedding_model === model &&
            e.embedding_version === version,
        ).length;
        return [{ cnt }] as T;
      }

      if (s.includes("FROM RAG_CHUNKS_FTS") && s.includes("MATCH")) {
        const ftsQ = String(params[0] ?? "").replace(/"/g, "").toLowerCase();
        const tokens = ftsQ.split(/\s+/).filter(Boolean);
        const matched = ftsRows
          .filter((f) =>
            tokens.length === 0
              ? true
              : tokens.some((t) => f.content.toLowerCase().includes(t)),
          )
          .map((f, i) => ({
            chunk_id: f.chunk_id,
            document_id: f.document_id,
            bm25: -(i + 1),
          }));
        return matched as T;
      }

      if (s.startsWith("SELECT 1 FROM RAG_CHUNKS_FTS")) {
        return [{ ok: 1 }] as T;
      }

      if (s.startsWith("SELECT COUNT(*)")) {
        return [{ cnt: chunks.length }] as T;
      }

      if (s.startsWith("SELECT STATUS, DELETED_AT FROM RAG_DOCUMENTS")) {
        const id = params[0] as string;
        const doc = docs.find((d) => d.id === id);
        return (doc ? [{ status: doc.status, deleted_at: doc.deleted_at }] : []) as T;
      }

      if (s.startsWith("SELECT * FROM RAG_DOCUMENTS WHERE ID")) {
        const id = params[0] as string;
        const found = docs.find((d) => d.id === id && d.deleted_at === null);
        return (found ? [found] : []) as T;
      }

      if (
        s.startsWith("SELECT * FROM RAG_CHUNKS") &&
        s.includes("DOCUMENT_ID") &&
        !s.includes("JOIN")
      ) {
        const docId = params[0] as string;
        const rows = chunks
          .filter((c) => c.document_id === docId)
          .sort((a, b) => a.chunk_index - b.chunk_index);
        return rows as T;
      }

      if (s.startsWith("SELECT * FROM RAG_DOCUMENTS")) {
        let rows = docs.slice();
        const includeDeleted = !s.includes("DELETED_AT IS NULL");
        if (!includeDeleted) rows = rows.filter((d) => d.deleted_at === null);
        let pi = 0;
        if (s.includes("SOURCE_TYPE = $")) {
          const st = params[pi++] as RagSourceType;
          rows = rows.filter((d) => d.source_type === st);
        }
        if (s.includes("STATUS = $")) {
          const ss = params[pi++] as RagStatus;
          rows = rows.filter((d) => d.status === ss);
        }
        if (s.includes("TITLE LIKE")) {
          const raw = params[pi++] as string;
          pi++;
          const kw = raw.replace(/%/g, "").toLowerCase();
          rows = rows.filter(
            (d) =>
              d.title.toLowerCase().includes(kw) ||
              (d.summary?.toLowerCase().includes(kw) ?? false),
          );
        }
        rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return rows as T;
      }

      if (s.includes("NOT EXISTS") && s.includes("FROM RAG_CHUNKS C")) {
        const model = params[0] as string;
        const version = params[1] as string;
        let sourceTypes: RagSourceType[] | undefined;
        let pi = 2;
        const inMatch = s.match(/D\.SOURCE_TYPE IN \(([^)]*)\)/);
        if (inMatch) {
          const count = (inMatch[1].match(/\$/g) ?? []).length;
          sourceTypes = params.slice(pi, pi + count) as RagSourceType[];
        }
        const active = activeChunks(docs, chunks, sourceTypes);
        const missing = active.filter(
          (c) =>
            !embeddings.some(
              (e) =>
                e.chunk_id === c.id &&
                e.embedding_model === model &&
                e.embedding_version === version,
            ),
        );
        return missing.map((c) => {
          const doc = docs.find((d) => d.id === c.document_id)!;
          return { ...c, doc_source_type: doc.source_type };
        }) as T;
      }

      if (
        s.includes("FROM RAG_CHUNKS C") &&
        s.includes("JOIN RAG_DOCUMENTS D") &&
        s.includes("C.ID IN")
      ) {
        const inMatch = s.match(/C\.ID IN \(([^)]*)\)/);
        if (!inMatch) return [] as T;
        const count = (inMatch[1].match(/\$/g) ?? []).length;
        const ids = params.slice(0, count) as string[];
        let pi = count;
        let sourceTypes: RagSourceType[] | undefined;
        const stMatch = s.match(/D\.SOURCE_TYPE IN \(([^)]*)\)/);
        if (stMatch) {
          const stCount = (stMatch[1].match(/\$/g) ?? []).length;
          sourceTypes = params.slice(pi, pi + stCount) as RagSourceType[];
        }
        const activeOnly = s.includes("D.STATUS = 'ACTIVE'");
        const rows = chunks.filter((c) => {
          if (!ids.includes(c.id)) return false;
          const doc = docs.find((d) => d.id === c.document_id);
          if (!doc || doc.deleted_at) return false;
          if (activeOnly && doc.status !== "active") return false;
          if (sourceTypes?.length && !sourceTypes.includes(doc.source_type)) {
            return false;
          }
          return true;
        });
        return rows.map((c) => {
          const doc = docs.find((d) => d.id === c.document_id)!;
          return { ...c, doc_source_type: doc.source_type };
        }) as T;
      }

      if (
        s.includes("FROM RAG_CHUNKS C") &&
        s.includes("JOIN RAG_DOCUMENTS D") &&
        s.includes("WHERE C.ID")
      ) {
        const chunkId = params[0] as string;
        const c = chunks.find((x) => x.id === chunkId);
        if (!c) return [] as T;
        const doc = docs.find((d) => d.id === c.document_id);
        if (!doc || doc.deleted_at || doc.status !== "active") return [] as T;
        return [{ ...c, doc_source_type: doc.source_type }] as T;
      }

      if (s.startsWith("FROM RAG_EMBEDDINGS E") || s.includes("FROM RAG_EMBEDDINGS E")) {
        const model = params[0] as string;
        const version = params[1] as string;
        let pi = 2;
        let sourceTypes: RagSourceType[] | undefined;
        const inMatch = s.match(/D\.SOURCE_TYPE IN \(([^)]*)\)/);
        if (inMatch) {
          const count = (inMatch[1].match(/\$/g) ?? []).length;
          sourceTypes = params.slice(pi, pi + count) as RagSourceType[];
          pi += count;
        }
        const activeOnly = s.includes("D.STATUS = 'ACTIVE'");
        let rows = embeddings.filter(
          (e) => e.embedding_model === model && e.embedding_version === version,
        );
        rows = rows.filter((e) => {
          const c = chunks.find((x) => x.id === e.chunk_id);
          if (!c) return false;
          const doc = docs.find((d) => d.id === c.document_id);
          if (!doc || doc.deleted_at) return false;
          if (activeOnly && doc.status !== "active") return false;
          if (sourceTypes?.length && !sourceTypes.includes(doc.source_type)) {
            return false;
          }
          return true;
        });
        return rows.map((e) => {
          const c = chunks.find((x) => x.id === e.chunk_id)!;
          const doc = docs.find((d) => d.id === c.document_id)!;
          return {
            ...c,
            doc_source_type: doc.source_type,
            vector_json: e.vector_json,
          };
        }) as T;
      }

      if (
        s.includes("FROM RAG_CHUNKS C") &&
        s.includes("JOIN RAG_DOCUMENTS D") &&
        !s.includes("NOT EXISTS")
      ) {
        let sourceTypes: RagSourceType[] | undefined;
        const inMatch = s.match(/D\.SOURCE_TYPE IN \(([^)]*)\)/);
        if (inMatch) {
          const count = (inMatch[1].match(/\$/g) ?? []).length;
          sourceTypes = params.slice(0, count) as RagSourceType[];
        }
        const active = activeChunks(docs, chunks, sourceTypes);
        return active.map((c) => {
          const doc = docs.find((d) => d.id === c.document_id)!;
          return { ...c, doc_source_type: doc.source_type };
        }) as T;
      }

      if (s.includes("FROM RAG_CHUNKS C") && s.includes("JOIN RAG_DOCUMENTS D")) {
        let rows = chunks.slice();
        const sourceTypesInClause = s.match(/D\.SOURCE_TYPE IN \(([^)]*)\)/);
        let paramIdx = 0;
        if (sourceTypesInClause) {
          const count = (sourceTypesInClause[1].match(/\$/g) ?? []).length;
          const allowed = params.slice(paramIdx, paramIdx + count) as RagSourceType[];
          paramIdx += count;
          rows = rows.filter((c) => {
            const doc = docs.find((d) => d.id === c.document_id);
            return doc && allowed.includes(doc.source_type);
          });
        }
        const activeOnly = s.includes("D.STATUS = 'ACTIVE'");
        rows = rows.filter((c) => {
          const doc = docs.find((d) => d.id === c.document_id);
          if (!doc || doc.deleted_at) return false;
          if (activeOnly && doc.status !== "active") return false;
          return true;
        });
        const likeKws = params.slice(paramIdx) as string[];
        if (likeKws.length > 0) {
          rows = rows.filter((c) =>
            likeKws.some((kw) => c.content.includes(kw.replace(/%/g, ""))),
          );
        }
        return rows.map((c) => {
          const doc = docs.find((d) => d.id === c.document_id)!;
          return { ...c, doc_source_type: doc.source_type };
        }) as T;
      }

      return [] as T;
    },
  };

  return db;
}
