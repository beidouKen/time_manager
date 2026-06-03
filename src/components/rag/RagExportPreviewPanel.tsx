// ============================================================
// RagExportPreviewPanel.tsx — V3.8.2 Coze-like 导出预览（不调 Coze API）
// ============================================================

import { Copy, FileJson } from "lucide-react";
import { useState } from "react";
import { useRagKnowledgeStore } from "@/store/ragKnowledgeStore";
import { cn } from "@/lib/utils";

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400",
        checked ? "bg-amber-500" : "bg-gray-200",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function RagExportPreviewPanel() {
  const exportPreview = useRagKnowledgeStore((s) => s.exportPreview);
  const demoLoading = useRagKnowledgeStore((s) => s.demoLoading);
  const buildExport = useRagKnowledgeStore((s) => s.buildExport);

  const [includeUserMaterial, setIncludeUserMaterial] = useState(true);
  const [includeExternalContext, setIncludeExternalContext] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    void buildExport({
      includeUserMaterial,
      includeExternalContext,
    });
  };

  const handleCopy = async () => {
    if (!exportPreview) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(exportPreview, null, 2),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 静默
    }
  };

  const jsonText = exportPreview
    ? JSON.stringify(exportPreview, null, 2)
    : "";

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <div className="p-5 border-b border-gray-200 space-y-4">
        <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
          <p className="text-xs text-red-700 leading-relaxed">
            本预览仅用于查看 Coze-like Dataset JSON 形态（历史演示），<strong>不会</strong>调用
            Coze API。正式 RAG 方向为 V3.8.4 Self-hosted RAG Engine，不再优先 Coze。
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">包含 user_material</p>
            <p className="text-xs text-gray-500">仅导出 active 用户资料</p>
          </div>
          <Toggle checked={includeUserMaterial} onChange={setIncludeUserMaterial} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">包含 external_context</p>
            <p className="text-xs text-gray-500">默认关闭；仅 active 外部资料</p>
          </div>
          <Toggle
            checked={includeExternalContext}
            onChange={setIncludeExternalContext}
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={demoLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50"
        >
          <FileJson size={16} />
          {demoLoading ? "生成中…" : "生成导出预览"}
        </button>

        {exportPreview && (
          <p className="text-xs text-gray-500">
            共 {exportPreview.meta.documentCount} 篇文档 · 来源：
            {exportPreview.meta.includedSourceTypes.join(", ")}
          </p>
        )}
      </div>

      <div className="flex-1 flex flex-col min-h-0 p-5">
        {jsonText ? (
          <>
            <div className="flex justify-end mb-2">
              <button
                onClick={() => void handleCopy()}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 border border-gray-200 rounded"
              >
                <Copy size={12} />
                {copied ? "已复制" : "复制 JSON"}
              </button>
            </div>
            <pre className="flex-1 overflow-auto text-[11px] leading-relaxed bg-gray-900 text-green-100 rounded-lg p-4 font-mono">
              {jsonText}
            </pre>
          </>
        ) : (
          <p className="text-sm text-gray-400">
            点击「生成导出预览」查看 Coze-like Dataset JSON。draft / archived /
            system_guidance / memory_summary 不会出现在导出中。
          </p>
        )}
      </div>
    </div>
  );
}
