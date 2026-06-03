// ============================================================
// RagRetrievePreviewPanel.tsx — V3.8.5 Self-hosted RAG 检索预览
// ============================================================

import { Search } from "lucide-react";
import { useState } from "react";
import { useRagKnowledgeStore } from "@/store/ragKnowledgeStore";
import { RagSourceTypeBadge } from "@/components/rag/RagStatusBadge";
import type { RagPreviewRetrieveMode, RagSourceType } from "@/types/rag.types";

const PREVIEW_SOURCE_OPTIONS: Array<{
  value: RagSourceType;
  label: string;
}> = [
  { value: "seed_knowledge", label: "内置知识" },
  { value: "user_material", label: "用户资料" },
  { value: "external_context", label: "外部资料" },
];

const MODE_OPTIONS: Array<{ value: RagPreviewRetrieveMode; label: string }> = [
  { value: "hybrid", label: "Hybrid (RRF)" },
  { value: "vector", label: "Vector" },
  { value: "keyword", label: "Keyword (FTS)" },
];

export function RagRetrievePreviewPanel() {
  const previewHits = useRagKnowledgeStore((s) => s.previewHits);
  const demoLoading = useRagKnowledgeStore((s) => s.demoLoading);
  const runPreview = useRagKnowledgeStore((s) => s.runPreview);

  const [query, setQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<RagSourceType[]>([
    "seed_knowledge",
  ]);
  const [mode, setMode] = useState<RagPreviewRetrieveMode>("hybrid");

  const toggleType = (t: RagSourceType) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  const handleSearch = () => {
    if (!query.trim() || selectedTypes.length === 0) return;
    void runPreview(query, { sourceTypes: selectedTypes, limit: 8, mode });
  };

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <div className="p-5 border-b border-gray-200 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">检索预览</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Self-hosted RAG Engine 调试：keyword (FTS5) / vector / hybrid (RRF)。仅检索
            active 文档。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">检索模式：</span>
          {MODE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-1 text-xs text-gray-700 cursor-pointer"
            >
              <input
                type="radio"
                name="rag-preview-mode"
                checked={mode === opt.value}
                onChange={() => setMode(opt.value)}
                className="text-amber-600 focus:ring-amber-400"
              />
              {opt.label}
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="输入查询词，例如：番茄工作法、专注、复习"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={demoLoading || !query.trim() || selectedTypes.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50"
          >
            检索
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-500">来源过滤：</span>
          {PREVIEW_SOURCE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedTypes.includes(opt.value)}
                onChange={() => toggleType(opt.value)}
                className="rounded border-gray-300 text-amber-600 focus:ring-amber-400"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {demoLoading && previewHits.length === 0 ? (
          <p className="text-sm text-gray-400">检索中…</p>
        ) : previewHits.length === 0 ? (
          <p className="text-sm text-gray-400">
            输入查询词并选择至少一种来源类型后点击「检索」。
          </p>
        ) : (
          <ul className="space-y-3">
            {previewHits.map((hit, i) => (
              <li
                key={`${hit.documentId}-${i}`}
                className="border border-gray-200 rounded-lg p-4 bg-gray-50/50"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-medium text-gray-800">{hit.title}</p>
                  <span className="text-xs text-gray-500 shrink-0">
                    score {(hit.score * 100).toFixed(0)}%
                  </span>
                </div>
                <RagSourceTypeBadge sourceType={hit.sourceType} className="mb-2" />
                <p className="text-xs text-gray-600 leading-relaxed line-clamp-4">
                  {hit.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
