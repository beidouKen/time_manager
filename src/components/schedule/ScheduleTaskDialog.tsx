import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Calendar } from "lucide-react";
import { toast } from "sonner";
import { format, addMinutes } from "date-fns";
import { useUiStore } from "@/store/uiStore";
import { useTaskStore } from "@/store/taskStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { ScheduleService } from "@/services/ScheduleService";
import { cn } from "@/lib/utils";

const scheduleService = new ScheduleService();

function toLocalDatetimeString(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

export function ScheduleTaskDialog() {
  const {
    scheduleDialogOpen,
    scheduleForTaskId,
    scheduleForTaskTitle,
    closeScheduleDialog,
  } = useUiStore();

  const { tasks, loadTasks } = useTaskStore();
  const { refreshBlocks } = useTimeBlockStore();

  const task = scheduleForTaskId
    ? tasks.find((t) => t.id === scheduleForTaskId)
    : null;

  const now = new Date();
  const defaultStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours() + 1,
    0
  );
  const defaultEnd = addMinutes(
    defaultStart,
    task?.estimated_duration_minutes ?? 60
  );

  const [startTime, setStartTime] = useState(toLocalDatetimeString(defaultStart));
  const [endTime, setEndTime] = useState(toLocalDatetimeString(defaultEnd));
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  useEffect(() => {
    if (scheduleDialogOpen) {
      const s = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours() + 1,
        0
      );
      const e = addMinutes(s, task?.estimated_duration_minutes ?? 60);
      setStartTime(toLocalDatetimeString(s));
      setEndTime(toLocalDatetimeString(e));
      setTitle(scheduleForTaskTitle ?? "");
      setConflictWarning(null);
    }
  }, [scheduleDialogOpen, scheduleForTaskTitle, task?.estimated_duration_minutes]);

  // Live conflict check when times change
  useEffect(() => {
    if (!startTime || !endTime || endTime <= startTime) {
      setConflictWarning(null);
      return;
    }
    const start = new Date(startTime).toISOString();
    const end = new Date(endTime).toISOString();
    scheduleService
      .checkConflicts(start, end)
      .then((result) => {
        if (result.hasConflict) {
          setConflictWarning(
            `与「${result.conflictingBlocks.map((b) => b.title).join("、")}」时间冲突`
          );
        } else {
          setConflictWarning(null);
        }
      })
      .catch(() => setConflictWarning(null));
  }, [startTime, endTime]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleForTaskId) return;
    if (!title.trim()) {
      toast.error("请输入时间块标题");
      return;
    }
    if (!startTime || !endTime) {
      toast.error("请选择开始和结束时间");
      return;
    }

    const startISO = new Date(startTime).toISOString();
    const endISO = new Date(endTime).toISOString();

    if (endISO <= startISO) {
      toast.error("结束时间必须晚于开始时间");
      return;
    }

    setSubmitting(true);
    try {
      await scheduleService.scheduleTaskToTimeBlock({
        taskId: scheduleForTaskId,
        title: title.trim(),
        startTime: startISO,
        endTime: endISO,
      });

      await Promise.all([loadTasks(), refreshBlocks()]);
      toast.success("任务已安排到日程");
      closeScheduleDialog();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root
      open={scheduleDialogOpen}
      onOpenChange={(o) => !o && closeScheduleDialog()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Calendar size={18} className="text-blue-600" />
              <Dialog.Title className="text-lg font-semibold text-gray-900">
                安排到日程
              </Dialog.Title>
            </div>
            <button
              onClick={closeScheduleDialog}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
          </div>

          {task && (
            <div className="mb-4 px-3 py-2 bg-blue-50 rounded-lg text-sm text-blue-800 font-medium">
              📌 {task.title}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Block title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                时间块标题 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="时间块名称..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Time range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  开始时间
                </label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  结束时间
                </label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={cn(
                    "w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2",
                    conflictWarning
                      ? "border-orange-400 focus:ring-orange-400"
                      : "border-gray-300 focus:ring-blue-500"
                  )}
                />
              </div>
            </div>

            {/* Conflict warning */}
            {conflictWarning && (
              <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-md text-sm text-orange-700">
                ⚠️ {conflictWarning}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeScheduleDialog}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submitting || !!conflictWarning}
                className={cn(
                  "px-4 py-2 text-sm text-white rounded-md transition-colors",
                  submitting || conflictWarning
                    ? "bg-blue-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700"
                )}
              >
                {submitting ? "安排中..." : "确认安排"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
