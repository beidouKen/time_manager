import { useState } from "react";
import { CalendarPlus, Pencil, Trash2, MoreVertical, CheckCircle2, Circle } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import { useTaskStore } from "@/store/taskStore";
import { useUiStore } from "@/store/uiStore";
import { TaskStatusBadge, PriorityBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { formatDate, formatDuration } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task.types";

interface TodoItemProps {
  task: Task;
}

export function TodoItem({ task }: TodoItemProps) {
  const { deleteTask, updateTask } = useTaskStore();
  const { openTaskForm, openScheduleDialog } = useUiStore();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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
        await updateTask(task.id, { status: "todo" });
        toast.success("任务已重新打开");
      } else {
        await updateTask(task.id, { status: "done" });
        toast.success("任务已完成 🎉");
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  const isDone = task.status === "done";
  const isCancelled = task.status === "cancelled";

  return (
    <>
      <div
        className={cn(
          "group flex items-start gap-3 p-3 rounded-lg border transition-all",
          isDone
            ? "bg-gray-50 border-gray-100 opacity-60"
            : "bg-white border-gray-200 hover:border-blue-200 hover:shadow-sm"
        )}
      >
        {/* Done toggle */}
        <button
          onClick={handleToggleDone}
          disabled={isCancelled}
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
                  {!isDone && !isCancelled && (
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
        description={`确定要删除「${task.title}」吗？已安排的时间块将保留，但不再与此任务关联。`}
        confirmLabel="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}
