// ============================================================
// RagDocumentForm.tsx — V3.8.1 知识库管理器右栏：新建文档表单
//
// UI 规则：
// - sourceType 下拉不展示 system_guidance / memory_summary
//   （UI 入口屏蔽，仅系统内部允许）。
// - 选 external_context 时显式提示：将强制为 draft，不能直接 active。
// - 选 seed_knowledge 时给"内置知识，谨慎编辑"提示。
// - 不暴露 chunk / embedding / SQL 字段。
// ============================================================

import { useState } from "react";
import type {
  IngestDocumentInput,
  RagSourceType,
  RagTrustLevel,
} from "@/types/rag.types";

type UiCreatableSourceType = Exclude<
  RagSourceType,
  "system_guidance" | "memory_summary"
>;

const SOURCE_TYPE_OPTIONS: Array<{ value: UiCreatableSourceType; label: string }> = [
  { value: "user_material", label: "用户资料（user_material）" },
  { value: "external_context", label: "外部资料（external_context，强制 draft）" },
  { value: "seed_knowledge", label: "内置知识（seed_knowledge，谨慎使用）" },
];

const TRUST_OPTIONS: Array<{ value: RagTrustLevel; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

interface Props {
  onSubmit: (input: IngestDocumentInput) => Promise<void>;
  onCancel: () => void;
}

export function RagDocumentForm({ onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [fullText, setFullText] = useState("");
  const [sourceType, setSourceType] = useState<UiCreatableSourceType>("user_material");
  const [tagsRaw, setTagsRaw] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [trustLevel, setTrustLevel] = useState<RagTrustLevel>("medium");
  const [submitting, setSubmitting] = useState(false);

  const isExternal = sourceType === "external_context";
  const isSeed = sourceType === "seed_knowledge";

  const canSubmit =
    title.trim().length > 0 &&
    (fullText.trim().length > 0 || summary.trim().length > 0) &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const tags = tagsRaw
        .split(/[,，;；\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const input: IngestDocumentInput = {
        sourceType,
        title: title.trim(),
        summary: summary.trim() || undefined,
        fullText: fullText.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        sourceRef: sourceRef.trim() || undefined,
        trustLevel,
      };
      await onSubmit(input);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">新建知识库资料</h3>
        <button
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          取消
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">标题 *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：番茄工作法 / 课程通知摘要"
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">来源类型 *</label>
          <select
            value={sourceType}
            onChange={(e) =>
              setSourceType(e.target.value as UiCreatableSourceType)
            }
            className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
          >
            {SOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {isExternal && (
            <p className="mt-1.5 text-xs text-pink-600 leading-relaxed">
              external_context 经 UI 写入将强制为 draft；
              若要进入 Chat 检索，需要管理员显式激活。
            </p>
          )}
          {isSeed && (
            <p className="mt-1.5 text-xs text-red-600 leading-relaxed">
              内置知识 seed_knowledge 是 Chat 主路径的默认来源，建议仅在确认必要时新增；
              已有 5 条经典时间管理理论由系统自动维护。
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">可信度</label>
          <select
            value={trustLevel}
            onChange={(e) => setTrustLevel(e.target.value as RagTrustLevel)}
            className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
          >
            {TRUST_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-gray-400">
            当前仅作为展示和未来排序加权使用，不会决定可见性。
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">摘要</label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            placeholder="一句话说明这条资料讲什么"
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            正文 / 完整文本
          </label>
          <textarea
            value={fullText}
            onChange={(e) => setFullText(e.target.value)}
            rows={8}
            placeholder="粘贴完整资料文本；系统会自动切片并生成可检索的 chunk。"
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            摘要和正文至少填一项。chunk 切分是底层行为，UI 不展示具体切片。
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">标签</label>
          <input
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="用逗号或空格分隔，例如：专注, 学习"
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            tags 仅参与排序加权，不作访问控制。
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">来源引用</label>
          <input
            type="text"
            value={sourceRef}
            onChange={(e) => setSourceRef(e.target.value)}
            placeholder="例如：URL / 文件路径 / 群消息 ID"
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
      </div>

      <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
        <p className="text-[11px] text-gray-500">
          新建资料默认为 <span className="font-medium">draft</span>，需手动启用后才能被检索。
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "保存中…" : "保存为草稿"}
          </button>
        </div>
      </div>
    </div>
  );
}
