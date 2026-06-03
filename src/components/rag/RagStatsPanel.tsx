// ============================================================
// RagStatsPanel.tsx — V3.8.2 知识库统计面板
// ============================================================

import { RefreshCcw } from "lucide-react";
import { useEffect } from "react";
import { useRagKnowledgeStore } from "@/store/ragKnowledgeStore";
import { RAG_SOURCE_LABELS } from "@/components/rag/RagStatusBadge";
import type { RagSourceType } from "@/types/rag.types";

const SOURCE_ORDER: RagSourceType[] = [
  "seed_knowledge",
  "user_material",
  "external_context",
  "memory_summary",
  "system_guidance",
];

export function RagStatsPanel() {
  const stats = useRagKnowledgeStore((s) => s.stats);
  const demoLoading = useRagKnowledgeStore((s) => s.demoLoading);
  const loadStats = useRagKnowledgeStore((s) => s.loadStats);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  return (
    <div className="h-full flex flex-col bg-white overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">知识库统计</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            本地 Dataset：default_time_manager_context（仿 Coze 结构，非真实 Coze API）
          </p>
        </div>
        <button
          onClick={() => void loadStats()}
          disabled={demoLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={demoLoading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>

      {!stats && demoLoading ? (
        <p className="text-sm text-gray-400">加载中…</p>
      ) : !stats ? (
        <p className="text-sm text-gray-400">暂无统计数据</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: "已启用", value: stats.activeCount, color: "text-green-700 bg-green-50" },
              { label: "草稿", value: stats.draftCount, color: "text-gray-700 bg-gray-100" },
              { label: "已归档", value: stats.archivedCount, color: "text-orange-700 bg-orange-50" },
              { label: "Chunks", value: stats.totalChunks, color: "text-blue-700 bg-blue-50" },
            ].map((item) => (
              <div
                key={item.label}
                className={`rounded-lg border border-gray-100 p-4 ${item.color}`}
              >
                <p className="text-2xl font-bold">{item.value}</p>
                <p className="text-xs mt-1 opacity-80">{item.label}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500 mb-2">
            文档总数：<span className="font-medium text-gray-800">{stats.totalDocuments}</span>
          </p>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">来源类型</th>
                  <th className="text-right px-4 py-2 font-medium">文档数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {SOURCE_ORDER.map((st) => (
                  <tr key={st}>
                    <td className="px-4 py-2 text-gray-700">
                      {RAG_SOURCE_LABELS[st].label}
                      <span className="ml-1 text-[10px] text-gray-400">({st})</span>
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-gray-800">
                      {stats.bySourceType[st]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
