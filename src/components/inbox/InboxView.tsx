import { useEffect } from "react";
import { Inbox, Plus } from "lucide-react";
import { TodoItem } from "@/components/todo/TodoItem";
import { useTaskStore } from "@/store/taskStore";
import { useUiStore } from "@/store/uiStore";

export function InboxView() {
  const { tasks, isLoading, loadTasks } = useTaskStore();
  const { openTaskForm } = useUiStore();

  useEffect(() => {
    loadTasks({ excludeDeleted: true });
  }, [loadTasks]);

  const inboxTasks = tasks.filter(
    (task) => task.status === "todo" && !task.deleted_at && !task.archived_at
  );

  return (
    <div className="h-full overflow-hidden bg-white flex flex-col">
      <header className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox size={18} className="text-blue-600" />
          <h1 className="text-base font-semibold text-gray-900">Inbox</h1>
          <span className="text-xs text-gray-400">{inboxTasks.length}</span>
        </div>
        <button
          onClick={() => openTaskForm()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          <Plus size={15} />
          新建
        </button>
      </header>
      <main className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading ? (
          <div className="text-sm text-gray-400 py-10 text-center">加载中...</div>
        ) : inboxTasks.length === 0 ? (
          <div className="text-sm text-gray-400 py-10 text-center">Inbox 为空</div>
        ) : (
          inboxTasks.map((task) => <TodoItem key={task.id} task={task} />)
        )}
      </main>
    </div>
  );
}
