// ============================================================
// RagIndexManager.ts — V3.8.6+ 关键词/向量索引重建与文档刷新
// ============================================================

import type { KeywordSearch } from "@/services/rag/keyword/KeywordSearch";
import {
  markFailed,
  markRunning,
  markSuccess,
  newJob,
  type RagIndexJob,
} from "@/services/rag/indexing/RagIndexJob";
import type { RagService } from "@/services/rag/RagService";
import type { VectorRagService } from "@/services/rag/VectorRagService";
import type { VectorStore } from "@/services/rag/vector/VectorStore";
import type { RagSourceType } from "@/types/rag.types";

const JOB_HISTORY_MAX = 20;

export class RagIndexManager {
  private readonly jobHistory: RagIndexJob[] = [];

  constructor(
    private readonly deps: {
      rag: RagService;
      vector: VectorRagService;
      keyword?: KeywordSearch;
      vectorStore?: VectorStore;
    },
  ) {}

  private pushJob(job: RagIndexJob): RagIndexJob {
    this.jobHistory.unshift(job);
    if (this.jobHistory.length > JOB_HISTORY_MAX) {
      this.jobHistory.length = JOB_HISTORY_MAX;
    }
    return job;
  }

  private replaceLatest(job: RagIndexJob): void {
    if (this.jobHistory.length > 0) {
      this.jobHistory[0] = job;
    }
  }

  async rebuildKeywordIndex(): Promise<RagIndexJob> {
    const start = Date.now();
    let job = newJob("keyword_rebuild");
    job = markRunning(job);
    this.pushJob(job);

    try {
      if (this.deps.keyword?.rebuildIndex) {
        await this.deps.keyword.rebuildIndex();
      }
      let backend = "none";
      if (this.deps.keyword?.healthCheck) {
        const h = await this.deps.keyword.healthCheck();
        backend = h.backend;
      }
      const done = markSuccess(job, {
        processed: 1,
        total: 1,
        skipped: 0,
        backend,
        durationMs: Date.now() - start,
      });
      this.replaceLatest(done);
      return done;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const done = markSuccess(job, {
        processed: 0,
        total: 0,
        skipped: 0,
        backend: "like-fallback",
        warnings: [msg],
        durationMs: Date.now() - start,
      });
      this.replaceLatest(done);
      return done;
    }
  }

  async rebuildVectorIndex(
    opts: { sourceTypes?: RagSourceType[] } = {},
  ): Promise<RagIndexJob> {
    const start = Date.now();
    let job = newJob("vector_rebuild");
    job = markRunning(job);
    this.pushJob(job);

    try {
      const r = await this.deps.vector.embedMissingChunks(opts);
      const total = r.total ?? r.embedded;
      const skipped = Math.max(0, total - r.embedded);
      let backend = "sqlite-vector-json";
      if (this.deps.vectorStore?.healthCheck) {
        const h = await this.deps.vectorStore.healthCheck();
        backend = h.backend;
      }
      const done = markSuccess(job, {
        processed: r.embedded,
        total,
        skipped,
        backend,
        durationMs: Date.now() - start,
      });
      this.replaceLatest(done);
      return done;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const done = markFailed(job, msg, [msg], Date.now() - start);
      this.replaceLatest(done);
      return done;
    }
  }

  async rebuildAll(
    opts: { sourceTypes?: RagSourceType[] } = {},
  ): Promise<RagIndexJob[]> {
    const kw = await this.rebuildKeywordIndex();
    const vec = await this.rebuildVectorIndex(opts);
    return [kw, vec];
  }

  async refreshDocument(documentId: string): Promise<RagIndexJob> {
    const start = Date.now();
    let job = newJob("document_refresh");
    job = markRunning(job);
    this.pushJob(job);

    try {
      await this.deps.vector.refreshEmbeddingForDocument(documentId);
      const done = markSuccess(job, {
        processed: 1,
        total: 1,
        skipped: 0,
        backend: "sqlite-vector-json",
        durationMs: Date.now() - start,
      });
      this.replaceLatest(done);
      return done;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const done = markFailed(job, msg, [msg], Date.now() - start);
      this.replaceLatest(done);
      return done;
    }
  }

  async clearVectorIndex(
    model: string,
    version: string,
  ): Promise<RagIndexJob> {
    const start = Date.now();
    let job = newJob("vector_clear");
    job = markRunning(job);
    this.pushJob(job);

    try {
      const deleted =
        (await this.deps.vectorStore?.clearModel?.(model, version)) ?? 0;
      const done = markSuccess(job, {
        processed: deleted,
        total: deleted,
        skipped: 0,
        backend: "sqlite-vector-json",
        durationMs: Date.now() - start,
      });
      this.replaceLatest(done);
      return done;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const done = markFailed(job, msg, [msg], Date.now() - start);
      this.replaceLatest(done);
      return done;
    }
  }

  async reindexForEmbeddingModelChange(
    oldModel: string,
    oldVersion: string,
    _newModel: string,
    _newVersion: string,
    opts: { sourceTypes?: RagSourceType[] } = {},
  ): Promise<RagIndexJob[]> {
    const clearJob = await this.clearVectorIndex(oldModel, oldVersion);
    const rebuildJob = await this.rebuildVectorIndex(opts);
    return [clearJob, rebuildJob];
  }

  async getIndexStatus(): Promise<{ jobs: RagIndexJob[] }> {
    return { jobs: [...this.jobHistory] };
  }
}
