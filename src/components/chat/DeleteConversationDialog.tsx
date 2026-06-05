import { useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useChatStore } from "@/store/chatStore";

const DELETE_WARNING =
  "这会隐藏此会话中的聊天消息，并取消该会话中未完成的确认请求。它不会删除已经创建的任务、时间块或操作日志。";

export function DeleteConversationDialog() {
  const clearHistory = useChatStore((s) => s.clearHistory);
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await clearHistory();
      setOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto p-1 rounded hover:bg-gray-100 text-gray-500"
        title="删除会话"
        aria-label="删除会话"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4 p-5"
          >
            <div className="flex items-center gap-2 mb-3 text-gray-800">
              <Trash2 size={18} className="text-red-500" />
              <h3 className="text-sm font-semibold">删除当前会话？</h3>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed mb-5">
              {DELETE_WARNING}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isDeleting}
                className="px-3 py-1.5 text-sm rounded border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={isDeleting}
                className="px-3 py-1.5 text-sm rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
              >
                {isDeleting ? "处理中…" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { DELETE_WARNING };
