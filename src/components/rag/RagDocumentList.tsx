// ============================================================
// RagDocumentList.tsx — V3.8.1 知识库管理器左栏列表
//
// 职责：
// - 展示当前 documents（按更新时间倒序）。
// - 提供 sourceType / status 过滤与关键词搜索。
// - 点击行触发 onSelect(id)，由父组件切换右栏详情。
// ============================================================

import { useState } from "react";
import { Search, RefreshCcw } from "lucide-react";
import type {
  RagDocument,
  RagSourceType,
  RagStatus,
} from "@/types/rag.types";
import {
  RagSourceTypeBadge,
  RagStatusBadge,
  RagTrustBadge,
} from "@/components/rag/RagStatusBadge";
import { cn } from "@/lib/utils";

interface Props {
  documents: RagDocument[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onReload: (opts: {
    sourceType?: RagSourceType;
    status?: RagStatus;
    search?: string;
  }) => void;
}

const SOURCE_FILTERS: Array<{ value: RagSourceType | "all"; label: string }> = [
  { value: "all", label: "全部来源" },
  { value: "seed_knowledge", label: "内置知识" },
  { value: "user_material", label: "用户资料" },
  { value: "external_context", label: "外部资料" },
  { value: "memory_summary", label: "记忆摘要" },
];

const STATUS_FILTERS: Array<{ value: RagStatus | "all"; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "draft", label: "草稿" },
  { value: "active", label: "已启用" },
  { value: "archived", label: "已归档" },
];

export function RagDocumentList({
  documents,
  loading,
  selectedId,
  onSelect,
  onNew,
  onReload,
}: Props) {
  const [sourceType, setSourceType] = useState<RagSourceType | "all">("all");
  const [status, setStatus] = useState<RagStatus | "all">("all");
  const [search, setSearch] = useState("");

  const triggerReload = (next?: Partial<{ sourceType: RagSourceType | "all"; status: RagStatus | "all"; search: string }>) => {
    const st = next?.sourceType ?? sourceType;
    const ss = next?.status ?? status;
    const sq = next?.search ?? search;
    onReload({
      sourceType: st === "all" ? undefined : st,
      status: ss === "all" ? undefined : ss,
      search: sq || undefined,
    });
  };

  return (
    <div className="flex flex-col h-full border-r border-gray-200 bg-gray-50">
      {/* 顶部工具栏 */}
      <div className="p-3 border-b border-gray-200 bg-white space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") triggerReload();
              }}
              placeholder="搜索标题/摘要"
              className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
          </div>
          <button
            onClick={() => triggerReload()}
            className="p-1.5 text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100"
            title="刷新"
          >
            <RefreshCcw size={14} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={sourceType}
            onChange={(e) => {
              const v = e.target.value as RagSourceType | "all";
              setSourceType(v);
              triggerReload({ sourceType: v });
            }}
            className="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-300"
          >
            {SOURCE_FILTERS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              const v = e.target.value as RagStatus | "all";
              setStatus(v);
              triggerReload({ status: v });
            }}
            className="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-300"
          >
            {STATUS_FILTERS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <button
          onClick={onNew}
          className="w-full px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          + 新建资料
        </button>
      </div>

      {/* 列表区 */}
      <div className="flex-1 overflow-y-auto">
        {loading && documents.length === 0 ? (
          <div className="p-4 text-xs text-gray-400 text-center">加载中…</div>
        ) : documents.length === 0 ? (
          <div className="p-6 text-xs text-gray-400 text-center leading-relaxed">
            还没有符合条件的资料。<br />
            点击上方 “新建资料” 录入第一条。
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {documents.map((doc) => (
              <li key={doc.id}>
                <button
                  onClick={() => onSelect(doc.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 transition-colors",
                    selectedId === doc.id
                      ? "bg-amber-50 border-l-2 border-amber-500"
                      : "hover:bg-white",
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-medium text-gray-800 line-clamp-1">{doc.title}</p>
                    <RagStatusBadge status={doc.status} className="shrink-0" />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <RagSourceTypeBadge sourceType={doc.sourceType} />
                    <RagTrustBadge level={doc.trustLevel} />
                  </div>
                  {doc.summary && (
                    <p className="mt-1.5 text-xs text-gray-500 line-clamp-2">{doc.summary}</p>
                  )}
                  <p className="mt-1 text-[10px] text-gray-400">
                    更新于 {new Date(doc.updatedAt).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
