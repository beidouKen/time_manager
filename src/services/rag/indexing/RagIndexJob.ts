// ============================================================
// RagIndexJob.ts — V3.8.6+ 索引任务类型与状态工具
// ============================================================

export type RagIndexJobType =
  | "keyword_rebuild"
  | "vector_rebuild"
  | "document_refresh"
  | "vector_clear";

export type RagIndexJobStatus = "pending" | "running" | "success" | "failed";

export interface RagIndexJob {
  id: string;
  type: RagIndexJobType;
  status: RagIndexJobStatus;
  startedAt: string;
  finishedAt?: string;
  processed: number;
  failed: number;
  errorMessage?: string;
  backend?: string;
  total?: number;
  skipped?: number;
  durationMs?: number;
  warnings?: string[];
}

export interface MarkSuccessOptions {
  processed: number;
  total?: number;
  skipped?: number;
  backend?: string;
  warnings?: string[];
  durationMs?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function newJob(type: RagIndexJobType): RagIndexJob {
  return {
    id: crypto.randomUUID(),
    type,
    status: "pending",
    startedAt: nowIso(),
    processed: 0,
    failed: 0,
  };
}

export function markRunning(job: RagIndexJob): RagIndexJob {
  return {
    ...job,
    status: "running",
    startedAt: nowIso(),
  };
}

/** 兼容旧签名 markSuccess(job, processed, backend?) */
export function markSuccess(
  job: RagIndexJob,
  processedOrOpts: number | MarkSuccessOptions,
  backend?: string,
): RagIndexJob {
  const opts: MarkSuccessOptions =
    typeof processedOrOpts === "number"
      ? { processed: processedOrOpts, backend }
      : processedOrOpts;

  return {
    ...job,
    status: "success",
    finishedAt: nowIso(),
    processed: opts.processed,
    failed: 0,
    backend: opts.backend,
    total: opts.total,
    skipped: opts.skipped,
    durationMs: opts.durationMs,
    warnings: opts.warnings,
    errorMessage: undefined,
  };
}

export function markFailed(
  job: RagIndexJob,
  message: string,
  warnings?: string[],
  durationMs?: number,
): RagIndexJob {
  return {
    ...job,
    status: "failed",
    finishedAt: nowIso(),
    errorMessage: message,
    warnings,
    durationMs,
  };
}
