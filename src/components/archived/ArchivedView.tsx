import { useEffect } from "react";
import { ArchiveRestore, Archive } from "lucide-react";
import { toast } from "sonner";
import { PriorityBadge, TaskStatusBadge } from "@/components/shared/StatusBadge";
import { useTaskStore } from "@/store/taskStore";
import { formatDate } from "@/lib/dateUtils";
import type { Task } from "@/types/task.types";

function ArchivedTaskRow({ task }: { task: Task }) {
  const unarchiveTask = useTaskStore((state) => state.unarchiveTask);

  const handleRestore = async () => {
    try {
      await unarchiveTask(task.id);
      toast.success("任务已恢复");
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-md border border-gray-200 bg-white">
      <Archive size={18} className="text-slate-500 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
          <TaskStatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
        </div>
        <p className="text-xs text-gray-400 mt-1">
          归档于 {formatDate(task.archived_at ?? task.updated_at, "MM-dd HH:mm")}
        </p>
      </div>
      <button
        onClick={handleRestore}
        title="恢复"
        className="p-1.5 rounded-md text-gray-400 hover:text-blue-700 hover:bg-blue-50"
      >
        <ArchiveRestore size={16} />
      </button>
    </div>
  );
}

export function ArchivedView() {
  const { tasks, loadTasks, isLoading } = useTaskStore();

  useEffect(() => {
    loadTasks({ excludeDeleted: true, includeArchived: true });
  }, [loadTasks]);

  const archivedTasks = tasks
    .filter((task) => !task.deleted_at && !!task.archived_at)
    .sort((a, b) => (b.archived_at ?? b.updated_at).localeCompare(a.archived_at ?? a.updated_at));

  return (
    <div className="h-full overflow-hidden bg-white flex flex-col">
      <header className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        <Archive size={18} className="text-slate-600" />
        <h1 className="text-base font-semibold text-gray-900">Archived</h1>
        <span className="text-xs text-gray-400">{archivedTasks.length}</span>
      </header>
      <main className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading ? (
          <div className="text-sm text-gray-400 py-10 text-center">加载中...</div>
        ) : archivedTasks.length === 0 ? (
          <div className="text-sm text-gray-400 py-10 text-center">暂无归档任务</div>
        ) : (
          archivedTasks.map((task) => <ArchivedTaskRow key={task.id} task={task} />)
        )}
      </main>
    </div>
  );
}
