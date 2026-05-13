import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  MoreVertical,
  Check,
  SkipForward,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useTaskStore } from "@/store/taskStore";
import { useUiStore } from "@/store/uiStore";
import { BlockStatusBadge, BlockTypeDot } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { getBlockTopPx, getBlockHeightPx, formatTime, getBlockDurationMinutes } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import type { TimeBlock } from "@/types/timeblock.types";

const TYPE_COLORS: Record<TimeBlock["type"], string> = {
  task: "bg-blue-50 border-blue-200 hover:border-blue-400",
  event: "bg-purple-50 border-purple-200 hover:border-purple-400",
  break: "bg-green-50 border-green-200 hover:border-green-400",
  routine: "bg-orange-50 border-orange-200 hover:border-orange-400",
};

const TYPE_HEADER_COLORS: Record<TimeBlock["type"], string> = {
  task: "bg-blue-500",
  event: "bg-purple-500",
  break: "bg-green-500",
  routine: "bg-orange-500",
};

interface TimeBlockCardProps {
  block: TimeBlock;
  dayStart: Date;
}

export function TimeBlockCard({ block, dayStart }: TimeBlockCardProps) {
  const { updateBlockStatus, deleteBlock, moveBackToTask } = useTimeBlockStore();
  const { loadTasks } = useTaskStore();
  const { openTimeBlockForm } = useUiStore();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmMoveBackOpen, setConfirmMoveBackOpen] = useState(false);

  const top = getBlockTopPx(block.start_time, dayStart);
  const height = getBlockHeightPx(block.start_time, block.end_time);
  const durationMins = getBlockDurationMinutes(block.start_time, block.end_time);
  const isShort = height < 45;
  const isDone = block.status === "done";
  const isSkipped = block.status === "skipped";
  const isCancelled = block.status === "cancelled";
  const isInactive = isDone || isSkipped || isCancelled;

  const canMoveBack =
    !!block.task_id &&
    block.type === "task" &&
    block.status !== "done" &&
    block.status !== "in_progress";

  const handleMarkDone = async () => {
    try {
      await updateBlockStatus(block.id, "done");
      toast.success("已标记完成");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleMarkSkipped = async () => {
    try {
      await updateBlockStatus(block.id, "skipped");
      toast.success("已跳过");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteBlock(block.id);
      toast.success("时间块已删除");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleMoveBack = async () => {
    try {
      const result = await moveBackToTask(block.id);
      await loadTasks();
      toast.success(
        result.taskStatusUpdatedTo === "todo"
          ? "已移回待办列表"
          : "时间块已移除，任务仍有其他安排"
      );
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <>
      <div
        className={cn(
          "absolute left-14 right-2 rounded-md border transition-all group",
          TYPE_COLORS[block.type],
          isInactive && "opacity-50"
        )}
        style={{ top, height: Math.max(height, 24), zIndex: 10 }}
      >
        {/* Color bar */}
        <div
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1 rounded-l-md",
            TYPE_HEADER_COLORS[block.type]
          )}
        />

        {/* Content */}
        <div className="pl-3 pr-7 py-1 h-full overflow-hidden">
          <div className={cn("flex items-center gap-1.5", isShort && "flex-row")}>
            <BlockTypeDot type={block.type} />
            <span
              className={cn(
                "text-xs font-semibold text-gray-800 truncate",
                isDone && "line-through text-gray-400"
              )}
            >
              {block.title}
            </span>
          </div>
          {!isShort && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-500">
                {formatTime(block.start_time)}–{formatTime(block.end_time)}
              </span>
              <span className="text-xs text-gray-400">{durationMins}分钟</span>
              <BlockStatusBadge status={block.status} />
            </div>
          )}
        </div>

        {/* Actions menu */}
        <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-white/70">
                <MoreVertical size={13} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="bg-white rounded-lg shadow-lg border border-gray-200 p-1 min-w-[160px] z-50"
                sideOffset={4}
                align="end"
              >
                {!isInactive && (
                  <>
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm text-green-700 rounded hover:bg-green-50 cursor-pointer outline-none"
                      onClick={handleMarkDone}
                    >
                      <Check size={14} />
                      标记完成
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 rounded hover:bg-gray-50 cursor-pointer outline-none"
                      onClick={handleMarkSkipped}
                    >
                      <SkipForward size={14} />
                      跳过
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />
                  </>
                )}
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded hover:bg-gray-50 cursor-pointer outline-none"
                  onClick={() => openTimeBlockForm(block.id)}
                >
                  <Pencil size={14} />
                  编辑
                </DropdownMenu.Item>
                {canMoveBack && (
                  <DropdownMenu.Item
                    className="flex items-center gap-2 px-3 py-2 text-sm text-blue-700 rounded hover:bg-blue-50 cursor-pointer outline-none"
                    onClick={() => setConfirmMoveBackOpen(true)}
                  >
                    <Undo2 size={14} />
                    移回 Todo
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 rounded hover:bg-red-50 cursor-pointer outline-none"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  <Trash2 size={14} />
                  删除时间块
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="删除时间块"
        description={`确定要删除「${block.title}」时间块吗？`}
        confirmLabel="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={confirmMoveBackOpen}
        onOpenChange={setConfirmMoveBackOpen}
        title="移回待办"
        description={`将「${block.title}」从日程中移除，任务将回到待办列表。`}
        confirmLabel="移回 Todo"
        onConfirm={handleMoveBack}
      />
    </>
  );
}
