import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useTaskStore } from "@/store/taskStore";
import { useUiStore } from "@/store/uiStore";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/types/task.types";

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "低优先级" },
  { value: "medium", label: "中优先级" },
  { value: "high", label: "高优先级" },
  { value: "urgent", label: "紧急" },
];

export function TodoForm() {
  const { taskFormOpen, editingTaskId, closeTaskForm } = useUiStore();
  const { tasks, addTask, updateTask } = useTaskStore();

  const editingTask = editingTaskId
    ? tasks.find((t) => t.id === editingTaskId)
    : null;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [category, setCategory] = useState("");
  const [isFlexible, setIsFlexible] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editingTask) {
      setTitle(editingTask.title);
      setDescription(editingTask.description ?? "");
      setDeadline(editingTask.deadline ? editingTask.deadline.slice(0, 16) : "");
      setEstimatedMinutes(
        editingTask.estimated_duration_minutes
          ? String(editingTask.estimated_duration_minutes)
          : ""
      );
      setPriority(editingTask.priority);
      setCategory(editingTask.category ?? "");
      setIsFlexible(editingTask.is_flexible);
    } else {
      setTitle("");
      setDescription("");
      setDeadline("");
      setEstimatedMinutes("");
      setPriority("medium");
      setCategory("");
      setIsFlexible(true);
    }
  }, [editingTask, taskFormOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("任务标题不能为空");
      return;
    }
    setSubmitting(true);
    try {
      if (editingTask) {
        await updateTask(editingTask.id, {
          title: title.trim(),
          description: description.trim() || undefined,
          deadline: deadline || undefined,
          estimated_duration_minutes: estimatedMinutes
            ? parseInt(estimatedMinutes)
            : undefined,
          priority,
          category: category.trim() || undefined,
          is_flexible: isFlexible,
        });
        toast.success("任务已更新");
      } else {
        await addTask({
          title: title.trim(),
          description: description.trim() || undefined,
          deadline: deadline || undefined,
          estimated_duration_minutes: estimatedMinutes
            ? parseInt(estimatedMinutes)
            : undefined,
          priority,
          category: category.trim() || undefined,
          is_flexible: isFlexible,
        });
        toast.success("任务已创建");
      }
      closeTaskForm();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={taskFormOpen} onOpenChange={(o) => !o && closeTaskForm()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-xl shadow-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              {editingTask ? "编辑任务" : "新建任务"}
            </Dialog.Title>
            <button
              onClick={closeTaskForm}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                任务标题 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入任务标题..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                描述
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="任务详情（可选）..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Priority & Category row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  优先级
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  分类
                </label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="如：学习、工作..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Deadline & Duration row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  截止时间
                </label>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  预计时长（分钟）
                </label>
                <input
                  type="number"
                  value={estimatedMinutes}
                  onChange={(e) => setEstimatedMinutes(e.target.value)}
                  placeholder="如：30"
                  min={1}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Flexible toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_flexible"
                checked={isFlexible}
                onChange={(e) => setIsFlexible(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded"
              />
              <label htmlFor="is_flexible" className="text-sm text-gray-700">
                时间可弹性调整
              </label>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeTaskForm}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={cn(
                  "px-4 py-2 text-sm text-white bg-blue-600 rounded-md transition-colors",
                  submitting
                    ? "opacity-60 cursor-not-allowed"
                    : "hover:bg-blue-700"
                )}
              >
                {submitting ? "保存中..." : editingTask ? "保存修改" : "创建任务"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
