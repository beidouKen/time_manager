import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, SkipForward, Clock } from "lucide-react";
import { toast } from "sonner";
import { useHeartbeatStore } from "@/store/heartbeatStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useTaskStore } from "@/store/taskStore";
import { formatTime } from "@/lib/dateUtils";

export function ExecutionFeedbackDialog() {
  const {
    isFeedbackDialogOpen,
    pendingFeedbackBlock,
    closeFeedbackDialog,
    completeBlock,
    skipBlock,
    delayBlock,
  } = useHeartbeatStore();
  const { refreshBlocks } = useTimeBlockStore();
  const { loadTasks } = useTaskStore();
  const [feedbackNote, setFeedbackNote] = useState("");
  const [loading, setLoading] = useState(false);

  if (!pendingFeedbackBlock) return null;

  const block = pendingFeedbackBlock;

  const handleAction = async (
    action: () => Promise<void>,
    successMsg: string
  ) => {
    if (loading) return;
    setLoading(true);
    try {
      await action();
      await Promise.all([refreshBlocks(), loadTasks()]);
      setFeedbackNote("");
      toast.success(successMsg);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Root
      open={isFeedbackDialogOpen}
      onOpenChange={(open) => {
        if (!open) closeFeedbackDialog();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-white rounded-xl shadow-xl p-6 focus:outline-none">
          {/* 关闭按钮 */}
          <Dialog.Close className="absolute right-4 top-4 p-1 text-gray-400 hover:text-gray-700 rounded">
            <X size={16} />
          </Dialog.Close>

          {/* 标题 */}
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">
            刚才的安排完成了吗？
          </Dialog.Title>

          {/* 时间块信息 */}
          <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
            <p className="text-sm font-semibold text-gray-800">{block.title}</p>
            <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
              <Clock size={11} />
              {formatTime(block.start_time)} – {formatTime(block.end_time)}
            </p>
          </div>

          {/* 备注输入（可选） */}
          <div className="mt-4">
            <label className="block text-xs text-gray-500 mb-1.5">
              备注（可选）
            </label>
            <textarea
              value={feedbackNote}
              onChange={(e) => setFeedbackNote(e.target.value)}
              placeholder="简单记录一下..."
              rows={2}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* 操作按钮 */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() =>
                handleAction(
                  () => completeBlock(block.id, feedbackNote || undefined),
                  "太棒了！已标记完成"
                )
              }
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
            >
              <Check size={14} />
              完成
            </button>
            <button
              onClick={() =>
                handleAction(
                  () => skipBlock(block.id, feedbackNote || undefined),
                  "已跳过，任务回到待办"
                )
              }
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              <SkipForward size={14} />
              跳过
            </button>
            <button
              onClick={() =>
                handleAction(
                  () => delayBlock(block.id, feedbackNote || undefined),
                  "已延迟，可稍后重新安排"
                )
              }
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-50 transition-colors"
            >
              延迟
            </button>
          </div>

          {/* 延迟说明 */}
          <p className="mt-3 text-xs text-gray-400 text-center">
            选择"延迟"后可在时间轴中重新安排该任务
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
