// ============================================================
// RagStatusBadge.tsx — V3.8.1 资料状态/可信度/来源类型徽章
//
// 纯展示组件；没有副作用。所有 label / className 映射集中在这里，
// 便于后续根据交互反馈快速微调视觉。
// ============================================================

import { cn } from "@/lib/utils";
import type {
  RagSourceType,
  RagStatus,
  RagTrustLevel,
} from "@/types/rag.types";

const STATUS_CONFIG: Record<RagStatus, { label: string; className: string }> = {
  draft: { label: "草稿", className: "bg-gray-100 text-gray-600" },
  active: { label: "已启用", className: "bg-green-100 text-green-700" },
  archived: { label: "已归档", className: "bg-orange-100 text-orange-600" },
};

const TRUST_CONFIG: Record<RagTrustLevel, { label: string; className: string }> = {
  low: { label: "低", className: "bg-gray-100 text-gray-500" },
  medium: { label: "中", className: "bg-blue-100 text-blue-600" },
  high: { label: "高", className: "bg-purple-100 text-purple-700" },
};

const SOURCE_CONFIG: Record<RagSourceType, { label: string; className: string }> = {
  seed_knowledge: { label: "内置知识", className: "bg-amber-50 text-amber-700 border-amber-200" },
  user_material: { label: "用户资料", className: "bg-sky-50 text-sky-700 border-sky-200" },
  external_context: { label: "外部资料", className: "bg-pink-50 text-pink-700 border-pink-200" },
  memory_summary: { label: "记忆摘要", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  system_guidance: { label: "系统指引", className: "bg-red-50 text-red-700 border-red-200" },
};

export function RagStatusBadge({ status, className }: { status: RagStatus; className?: string }) {
  const c = STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", c.className, className)}>
      {c.label}
    </span>
  );
}

export function RagTrustBadge({ level, className }: { level: RagTrustLevel; className?: string }) {
  const c = TRUST_CONFIG[level];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", c.className, className)} title={`可信度：${c.label}`}>
      可信 {c.label}
    </span>
  );
}

export function RagSourceTypeBadge({
  sourceType,
  className,
}: {
  sourceType: RagSourceType;
  className?: string;
}) {
  const c = SOURCE_CONFIG[sourceType];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", c.className, className)}>
      {c.label}
    </span>
  );
}

export const RAG_SOURCE_LABELS = SOURCE_CONFIG;
