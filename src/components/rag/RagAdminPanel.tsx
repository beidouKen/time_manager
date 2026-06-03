// ============================================================
// RagAdminPanel.tsx — V3.8.7 RAG Engine 管理轻量面板
// ============================================================

import { useCallback, useState } from "react";
import { Activity, Database, Loader2, PlayCircle } from "lucide-react";
import { getRagAdminActions } from "@/services/rag/admin/getRagAdminActions";
import type { RagEngineHealth } from "@/services/rag/engine/RagEngine";
import type { RagEvalResult } from "@/services/rag/eval/RagEvalDataset";
import type { RagIndexJob } from "@/services/rag/indexing/RagIndexJob";

type LoadingKey = "health" | "kw" | "vec" | "all" | "eval" | null;

function formatJob(job: RagIndexJob | undefined): string {
  if (!job) return "";
  const parts = [
    `status=${job.status}`,
    `processed=${job.processed}`,
    job.total != null ? `total=${job.total}` : null,
    job.skipped != null ? `skipped=${job.skipped}` : null,
    job.durationMs != null ? `${job.durationMs}ms` : null,
    job.backend ? `backend=${job.backend}` : null,
  ].filter(Boolean);
  if (job.warnings?.length) parts.push(`warnings=${job.warnings.join("; ")}`);
  if (job.errorMessage) parts.push(`error=${job.errorMessage}`);
  return parts.join(" · ");
}

export function RagAdminPanel() {
  const admin = getRagAdminActions();
  const [loading, setLoading] = useState<LoadingKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<RagEngineHealth | null>(null);
  const [lastJob, setLastJob] = useState<string | null>(null);
  const [evalSummary, setEvalSummary] = useState<string | null>(null);

  const run = useCallback(
    async (key: LoadingKey, fn: () => Promise<void>) => {
      setError(null);
      setLoading(key);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(null);
      }
    },
    [],
  );

  if (!admin) {
    return (
      <div className="p-6 text-sm text-gray-500">
        RAG Admin 不可用（引擎装配失败）。Chat 主路径不受影响。
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-y-auto p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-800">RAG Engine 管理</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          仅管理员可见；不暴露 API Key；失败不影响应用主路径。
        </p>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          disabled={loading !== null}
          onClick={() =>
            run("health", async () => {
              const h = await admin.healthCheck();
              setHealth(h);
            })
          }
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
        >
          {loading === "health" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Activity size={14} />
          )}
          健康检查
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() =>
            run("kw", async () => {
              const job = await admin.rebuildKeywordIndex();
              setLastJob(formatJob(job));
            })
          }
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
        >
          {loading === "kw" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Database size={14} />
          )}
          重建关键词索引
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() =>
            run("vec", async () => {
              const job = await admin.rebuildVectorIndex();
              setLastJob(formatJob(job));
            })
          }
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
        >
          {loading === "vec" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Database size={14} />
          )}
          重建向量索引
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() =>
            run("all", async () => {
              const jobs = await admin.rebuildAllIndexes();
              setLastJob(jobs.map((j) => formatJob(j)).join("\n"));
            })
          }
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 rounded-md hover:bg-amber-100 disabled:opacity-50"
        >
          {loading === "all" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Database size={14} />
          )}
          全部重建
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() =>
            run("eval", async () => {
              const r: RagEvalResult = await admin.runDefaultEvaluation();
              setEvalSummary(
                `hit@K=${(r.hitAtK * 100).toFixed(0)}% · matched=${r.matchedCount}/${r.totalCases} · ` +
                  `sourceType=${(r.sourceTypeMatchRate * 100).toFixed(0)}% · ` +
                  `title=${(r.titleMatchRate * 100).toFixed(0)}% · ` +
                  `avgTopScore=${r.averageTopScore.toFixed(3)}`,
              );
            })
          }
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-800 bg-blue-50 rounded-md hover:bg-blue-100 disabled:opacity-50"
        >
          {loading === "eval" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <PlayCircle size={14} />
          )}
          运行评测
        </button>
      </div>

      {health && (
        <div className="mb-4 p-3 text-xs bg-gray-50 border border-gray-200 rounded-md space-y-1">
          <div>
            <span className="font-medium text-gray-700">Engine</span> mode={health.mode}{" "}
            ok={String(health.ok)}
          </div>
          <div>
            keyword: {health.keyword.backend} ({health.keyword.ok ? "ok" : "fail"})
          </div>
          <div>
            vector: {health.vector.backend} ({health.vector.ok ? "ok" : "fail"})
          </div>
        </div>
      )}

      {lastJob && (
        <div className="mb-4 p-3 text-xs font-mono text-gray-600 bg-gray-50 border border-gray-200 rounded-md whitespace-pre-wrap">
          {lastJob}
        </div>
      )}

      {evalSummary && (
        <div className="p-3 text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded-md">
          {evalSummary}
        </div>
      )}
    </div>
  );
}
