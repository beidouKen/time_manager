import { useState } from "react";
import { Play, Check, SkipForward, Clock } from "lucide-react";
import { toast } from "sonner";
import { useHeartbeatStore } from "@/store/heartbeatStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useTaskStore } from "@/store/taskStore";
import { formatTime } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import type { TimeBlock } from "@/types/timeblock.types";

interface CurrentFocusCardProps {
  block: TimeBlock;
}

export function CurrentFocusCard({ block }: CurrentFocusCardProps) {
  const { startBlock, completeBlock, skipBlock, delayBlock } = useHeartbeatStore();
  const { refreshBlocks } = useTimeBlockStore();
  const { loadTasks } = useTaskStore();
  const [loading, setLoading] = useState(false);

  const isInProgress = block.status === "in_progress";

  const handleAction = async (
    action: () => Promise<void>,
    successMsg: string
  ) => {
    if (loading) return;
    setLoading(true);
    try {
      await action();
      await Promise.all([refreshBlocks(), loadTasks()]);
      toast.success(successMsg);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 flex items-center gap-3",
        isInProgress
          ? "bg-amber-50 border-amber-300"
          : "bg-blue-50 border-blue-200"
      )}
    >
      {/* 状态指示灯 */}
      <div
        className={cn(
          "w-2.5 h-2.5 rounded-full flex-shrink-0",
          isInProgress ? "bg-amber-400 animate-pulse" : "bg-blue-400"
        )}
      />

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{block.title}</p>
        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
          <Clock size={11} />
          {formatTime(block.start_time)} – {formatTime(block.end_time)}
          {isInProgress && (
            <span className="ml-1 text-amber-600 font-medium">进行中</span>
          )}
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {!isInProgress && (
          <button
            onClick={() =>
              handleAction(() => startBlock(block.id), "已开始计时")
            }
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            <Play size={11} />
            开始
          </button>
        )}
        <button
          onClick={() =>
            handleAction(() => completeBlock(block.id), "已标记完成")
          }
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
        >
          <Check size={11} />
          完成
        </button>
        <button
          onClick={() =>
            handleAction(() => skipBlock(block.id), "已跳过")
          }
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 transition-colors"
        >
          <SkipForward size={11} />
          跳过
        </button>
        <button
          onClick={() =>
            handleAction(() => delayBlock(block.id), "已延迟，可稍后重新安排")
          }
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-50 transition-colors"
        >
          延迟
        </button>
      </div>
    </div>
  );
}
