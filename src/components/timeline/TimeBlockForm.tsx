import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useUiStore } from "@/store/uiStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { ScheduleService } from "@/services/ScheduleService";
import { cn } from "@/lib/utils";
import type { TimeBlockType } from "@/types/timeblock.types";

const scheduleService = new ScheduleService();

const TYPE_OPTIONS: { value: TimeBlockType; label: string }[] = [
  { value: "task", label: "任务" },
  { value: "event", label: "事件" },
  { value: "break", label: "休息" },
  { value: "routine", label: "例程" },
];

function toLocalDatetimeString(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

export function TimeBlockForm() {
  const { timeBlockFormOpen, editingBlockId, closeTimeBlockForm } = useUiStore();
  const { blocks, addBlock, updateBlock, currentDate } = useTimeBlockStore();

  const editingBlock = editingBlockId
    ? blocks.find((b) => b.id === editingBlockId)
    : null;

  const defaultStart = new Date(currentDate);
  defaultStart.setHours(9, 0, 0, 0);
  const defaultEnd = new Date(currentDate);
  defaultEnd.setHours(10, 0, 0, 0);

  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(toLocalDatetimeString(defaultStart));
  const [endTime, setEndTime] = useState(toLocalDatetimeString(defaultEnd));
  const [type, setType] = useState<TimeBlockType>("event");
  const [submitting, setSubmitting] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  useEffect(() => {
    if (editingBlock) {
      setTitle(editingBlock.title);
      setStartTime(toLocalDatetimeString(new Date(editingBlock.start_time)));
      setEndTime(toLocalDatetimeString(new Date(editingBlock.end_time)));
      setType(editingBlock.type);
    } else {
      setTitle("");
      setStartTime(toLocalDatetimeString(defaultStart));
      setEndTime(toLocalDatetimeString(defaultEnd));
      setType("event");
    }
    setConflictWarning(null);
  }, [editingBlock, timeBlockFormOpen]);

  // Live conflict check
  useEffect(() => {
    if (!startTime || !endTime || endTime <= startTime) {
      setConflictWarning(null);
      return;
    }
    const start = new Date(startTime).toISOString();
    const end = new Date(endTime).toISOString();
    scheduleService
      .checkConflicts(start, end, editingBlockId ?? undefined)
      .then((result) => {
        setConflictWarning(
          result.hasConflict
            ? `与「${result.conflictingBlocks.map((b) => b.title).join("、")}」冲突`
            : null
        );
      })
      .catch(() => setConflictWarning(null));
  }, [startTime, endTime, editingBlockId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("标题不能为空");
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
      if (editingBlock) {
        await updateBlock(editingBlock.id, {
          title: title.trim(),
          start_time: startISO,
          end_time: endISO,
          type,
        });
        toast.success("时间块已更新");
      } else {
        await addBlock({
          title: title.trim(),
          start_time: startISO,
          end_time: endISO,
          type,
          source: "manual",
        });
        toast.success("时间块已创建");
      }
      closeTimeBlockForm();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root
      open={timeBlockFormOpen}
      onOpenChange={(o) => !o && closeTimeBlockForm()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              {editingBlock ? "编辑时间块" : "新建时间块"}
            </Dialog.Title>
            <button onClick={closeTimeBlockForm} className="text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                标题 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="时间块名称..."
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                类型
              </label>
              <div className="flex gap-2">
                {TYPE_OPTIONS.filter((o) => o.value !== "task").map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setType(opt.value)}
                    className={cn(
                      "flex-1 py-1.5 text-sm rounded-md border transition-colors",
                      type === opt.value
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

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

            {conflictWarning && (
              <div className="px-3 py-2 bg-orange-50 border border-orange-200 rounded-md text-sm text-orange-700">
                ⚠️ {conflictWarning}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeTimeBlockForm}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submitting || !!conflictWarning}
                className={cn(
                  "px-4 py-2 text-sm text-white rounded-md transition-colors",
                  submitting || conflictWarning ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                )}
              >
                {submitting ? "保存中..." : editingBlock ? "保存修改" : "创建"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
