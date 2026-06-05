import { useState } from "react";
import {
  Archive,
  CalendarClock,
  CalendarPlus,
  Pencil,
  RotateCcw,
  SkipForward,
  Trash2,
  MoreVertical,
  CheckCircle2,
  Circle,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import { useTaskStore } from "@/store/taskStore";
import { useUiStore } from "@/store/uiStore";
import { TaskStatusBadge, PriorityBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { formatDate, formatDuration, formatTime } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task.types";
import type { TimeBlock } from "@/types/timeblock.types";

interface TodoItemProps {
  task: Task;
  /** 今日 TimeBlock 列表，用于展示排期时段与进行中指示 */
  todayBlocks?: TimeBlock[];
  /** 当前时间，由父组件传入保持一致 */
  now?: Date;
}

export function TodoItem({ task, todayBlocks = [], now = new Date() }: TodoItemProps) {
  const {
    deleteTask,
    completeTask,
    reopenTask,
    skipTaskToday,
    deferTask,
    archiveTask,
  } = useTaskStore();
  const { openTaskForm, openScheduleDialog } = useUiStore();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // ─── 今日 TimeBlock 状态 ────────────────────────────────────────────────
  const nowIso = now.toISOString();
  const taskBlocks = todayBlocks.filter((b) => b.task_id === task.id && !b.deleted_at);

  /** 当前正在执行中的时间块 */
  const activeBlock = taskBlocks.find(
    (b) =>
      (b.status === "in_progress" || b.status === "scheduled") &&
      b.start_time <= nowIso &&
      b.end_time > nowIso
  );
  const isActiveNow = !!activeBlock;

  /** 今日最近一个待开始的时间块 */
  const upcomingBlock = taskBlocks
    .filter((b) => b.status === "scheduled" && b.start_time > nowIso)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];

  /** 是否有今日已完成的时间块 */
  const hasDoneBlock = taskBlocks.some((b) => b.status === "done");

  const handleDelete = async () => {
    try {
      await deleteTask(task.id);
      toast.success("任务已删除");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleToggleDone = async () => {
    try {
      if (task.status === "done") {
        await reopenTask(task.id);
        toast.success("任务已重新打开");
      } else {
        await completeTask(task.id);
        toast.success("任务已完成");
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleSkipToday = async () => {
    try {
      await skipTaskToday(task.id);
      toast.success("已跳过今天");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleDeferTomorrow = async () => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      await deferTask(task.id, tomorrow.toISOString());
      toast.success("已延期到明天");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleArchive = async () => {
    try {
      await archiveTask(task.id);
      toast.success("任务已归档");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const isDone = task.status === "done";
  const isCancelled = task.status === "cancelled";
  const isArchived = task.status === "archived" || !!task.archived_at;
  const canEditAsActive = !isDone && !isCancelled && !isArchived;
  const canArchive = isDone || isCancelled;

  return (
    <>
      <div
        className={cn(
          "group flex items-start gap-3 p-3 rounded-lg border transition-all",
          isDone
            ? "bg-gray-50 border-gray-100 opacity-60"
            : isActiveNow
            ? "bg-yellow-50 border-yellow-200 hover:border-yellow-300 hover:shadow-sm"
            : "bg-white border-gray-200 hover:border-blue-200 hover:shadow-sm"
        )}
      >
        {/* Done toggle */}
        <button
          onClick={handleToggleDone}
          disabled={isCancelled || isArchived}
          className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isDone ? (
            <CheckCircle2 size={18} className="text-green-500" />
          ) : (
            <Circle size={18} />
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                "text-sm font-medium leading-snug",
                isDone ? "line-through text-gray-400" : "text-gray-900"
              )}
            >
              {task.title}
            </p>
            {/* Actions */}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex-shrink-0 p-1 text-gray-300 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-all rounded">
                  <MoreVertical size={15} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="bg-white rounded-lg shadow-lg border border-gray-200 p-1 min-w-[150px] z-50"
                  sideOffset={4}
                  align="end"
                >
                  {canEditAsActive && (
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded hover:bg-blue-50 hover:text-blue-700 cursor-pointer outline-none"
                      onClick={() => openScheduleDialog(task.id, task.title)}
                    >
                      <CalendarPlus size={14} />
                      安排到日程
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Item
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded hover:bg-gray-50 cursor-pointer outline-none"
                    onClick={() => openTaskForm(task.id)}
                  >
                    <Pencil size={14} />
                    编辑
                  </DropdownMenu.Item>
                  {canEditAsActive && (
                    <>
                      <DropdownMenu.Item
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded hover:bg-gray-50 cursor-pointer outline-none"
                        onClick={handleSkipToday}
                      >
                        <SkipForward size={14} />
                        跳过今天
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded hover:bg-gray-50 cursor-pointer outline-none"
                        onClick={handleDeferTomorrow}
                      >
                        <CalendarClock size={14} />
                        延期到明天
                      </DropdownMenu.Item>
                    </>
                  )}
                  {isDone && (
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded hover:bg-gray-50 cursor-pointer outline-none"
                      onClick={() => void handleToggleDone()}
                    >
                      <RotateCcw size={14} />
                      重新打开
                    </DropdownMenu.Item>
                  )}
                  {canArchive && (
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded hover:bg-slate-50 cursor-pointer outline-none"
                      onClick={handleArchive}
                    >
                      <Archive size={14} />
                      归档
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />
                  <DropdownMenu.Item
                    className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 rounded hover:bg-red-50 cursor-pointer outline-none"
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    <Trash2 size={14} />
                    删除
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          {task.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
              {task.description}
            </p>
          )}

          {/* Meta */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {/* 今日时间块状态指示 */}
            {isActiveNow && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
                </span>
                {activeBlock ? `${formatTime(activeBlock.start_time)}–${formatTime(activeBlock.end_time)}` : "进行中"}
              </span>
            )}
            {!isActiveNow && upcomingBlock && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                今日 {formatTime(upcomingBlock.start_time)}
              </span>
            )}
            {!isActiveNow && !upcomingBlock && hasDoneBlock && (
              <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                今日已完成
              </span>
            )}
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.estimated_duration_minutes && (
              <span className="text-xs text-gray-400">
                {formatDuration(task.estimated_duration_minutes)}
              </span>
            )}
            {task.deadline && (
              <span className="text-xs text-gray-400">
                截止：{formatDate(task.deadline, "MM-dd HH:mm")}
              </span>
            )}
            {task.category && (
              <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                {task.category}
              </span>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="删除任务"
        description={`确定要删除「${task.title}」吗？关联时间块也会一并移出时间轴。`}
        confirmLabel="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}
