// ============================================================
// RagKnowledgeManagerDialog.tsx — V3.8.1 知识库管理器
//
// 全屏 Dialog，左右分栏：
// - 左：文档列表 + 过滤搜索 + 新建按钮
// - 右：选中文档的详情 / 操作按钮，或新建表单
//
// 安全提示：
// - 本组件只调用 useRagKnowledgeStore 的 actions，不直接读写 DB。
// - 也不触发 ToolRouter 或任何 task / time_block 写入。
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { BookOpen, X, ArrowLeft } from "lucide-react";
import { useRagKnowledgeStore } from "@/store/ragKnowledgeStore";
import type {
  IngestDocumentInput,
  RagSourceType,
  RagStatus,
} from "@/types/rag.types";
import { RagDocumentList } from "@/components/rag/RagDocumentList";
import { RagDocumentForm } from "@/components/rag/RagDocumentForm";
import {
  RAG_SOURCE_LABELS,
  RagSourceTypeBadge,
  RagStatusBadge,
  RagTrustBadge,
} from "@/components/rag/RagStatusBadge";

interface Props {
  open: boolean;
  onClose: () => void;
}

type ViewMode = "detail" | "new";

export function RagKnowledgeManagerDialog({ open, onClose }: Props) {
  const {
    documents,
    loading,
    error,
    selectedDocumentId,
    loadDocuments,
    createDraft,
    activate,
    archive,
    softDelete,
    selectDocument,
  } = useRagKnowledgeStore();

  const [viewMode, setViewMode] = useState<ViewMode>("detail");

  // 打开时自动拉取列表
  useEffect(() => {
    if (open) {
      void loadDocuments();
    }
  }, [open, loadDocuments]);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );

  if (!open) return null;

  const handleReload = (opts: {
    sourceType?: RagSourceType;
    status?: RagStatus;
    search?: string;
  }) => {
    void loadDocuments(opts);
  };

  const handleSelect = (id: string) => {
    selectDocument(id);
    setViewMode("detail");
  };

  const handleNew = () => {
    selectDocument(null);
    setViewMode("new");
  };

  const handleCreateSubmit = async (input: IngestDocumentInput) => {
    const created = await createDraft(input);
    if (created) {
      setViewMode("detail");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[1080px] max-w-[95vw] h-[700px] max-h-[92vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-white">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-amber-600" />
            <h2 className="text-base font-semibold text-gray-800">知识库管理器</h2>
            <span className="ml-2 px-2 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded-full">
              V3.8.1 / 开发者入口
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">
            {error}
          </div>
        )}

        {/* 主体两栏 */}
        <div className="flex-1 grid grid-cols-[340px_1fr] overflow-hidden">
          <RagDocumentList
            documents={documents}
            loading={loading}
            selectedId={selectedDocumentId}
            onSelect={handleSelect}
            onNew={handleNew}
            onReload={handleReload}
          />

          {viewMode === "new" ? (
            <RagDocumentForm
              onSubmit={handleCreateSubmit}
              onCancel={() => setViewMode("detail")}
            />
          ) : selectedDoc ? (
            <div className="h-full flex flex-col bg-white">
              <div className="px-5 py-3 border-b border-gray-200 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-gray-800 mb-1 truncate">{selectedDoc.title}</h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RagSourceTypeBadge sourceType={selectedDoc.sourceType} />
                    <RagStatusBadge status={selectedDoc.status} />
                    <RagTrustBadge level={selectedDoc.trustLevel} />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedDoc.status !== "active" && (
                    <button
                      onClick={() => void activate(selectedDoc.id)}
                      className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700"
                      title="启用后此文档将进入 RAG 检索（仍需 sourceType 开关）"
                    >
                      启用
                    </button>
                  )}
                  {selectedDoc.status !== "archived" && (
                    <button
                      onClick={() => void archive(selectedDoc.id)}
                      className="px-3 py-1 text-xs font-medium text-orange-700 bg-orange-100 rounded hover:bg-orange-200"
                    >
                      归档
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm("软删除这条资料？可在数据库中恢复（deleted_at 字段）。")) {
                        void softDelete(selectedDoc.id);
                      }
                    }}
                    className="px-3 py-1 text-xs font-medium text-red-700 bg-red-50 rounded hover:bg-red-100"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {selectedDoc.summary && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">摘要</p>
                    <p className="text-sm text-gray-700 leading-relaxed">{selectedDoc.summary}</p>
                  </div>
                )}

                {selectedDoc.tags.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">标签</p>
                    <div className="flex flex-wrap gap-1">
                      {selectedDoc.tags.map((t) => (
                        <span
                          key={t}
                          className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedDoc.sourceRef && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">来源引用</p>
                    <code className="block px-2 py-1 text-xs bg-gray-50 text-gray-700 rounded border border-gray-200 break-all">
                      {selectedDoc.sourceRef}
                    </code>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">创建时间</p>
                    <p>{new Date(selectedDoc.createdAt).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">更新时间</p>
                    <p>{new Date(selectedDoc.updatedAt).toLocaleString()}</p>
                  </div>
                  {selectedDoc.reviewedAt && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">启用时间</p>
                      <p>{new Date(selectedDoc.reviewedAt).toLocaleString()}</p>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500 leading-relaxed">
                  <p className="font-medium text-gray-700 mb-1">关于这条 {RAG_SOURCE_LABELS[selectedDoc.sourceType].label}：</p>
                  {selectedDoc.sourceType === "seed_knowledge" && (
                    <p>系统内置的时间管理理论。默认启用，Chat 主路径会引用。</p>
                  )}
                  {selectedDoc.sourceType === "user_material" && (
                    <p>你手动录入的学习/课程资料。设为 active 且 Settings 开启 "user_material 进入 Chat" 后才会被检索。</p>
                  )}
                  {selectedDoc.sourceType === "external_context" && (
                    <p>外部导入资料；默认 draft，建议人工审核后再启用。即便 active 也不会自动生成任务或时间块。</p>
                  )}
                  {selectedDoc.sourceType === "memory_summary" && (
                    <p>未来由 Memory 系统生成的用户行为摘要。当前阶段仅预留通道。</p>
                  )}
                  {selectedDoc.sourceType === "system_guidance" && (
                    <p>系统行为指引，仅系统内部维护，UI 不允许修改。</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 bg-gradient-to-br from-gray-50 to-white">
              <BookOpen size={36} className="mb-3 text-gray-300" />
              <p className="text-sm">从左侧选择一条资料</p>
              <p className="text-xs mt-1 text-gray-400">或点击 “新建资料” 录入新内容</p>
              <button
                onClick={() => void loadDocuments()}
                className="mt-4 flex items-center gap-1 px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
              >
                <ArrowLeft size={12} />
                刷新列表
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
