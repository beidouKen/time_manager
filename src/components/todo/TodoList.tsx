import { useEffect, useState } from "react";
import { Plus, ClipboardList } from "lucide-react";
import { useTaskStore } from "@/store/taskStore";
import { useUiStore } from "@/store/uiStore";
import { TodoItem } from "./TodoItem";
import { TodoFilters } from "./TodoFilters";
import type { TaskStatus } from "@/types/task.types";

export function TodoList() {
  const { tasks, isLoading, loadTasks } = useTaskStore();
  const { openTaskForm } = useUiStore();
  const [filter, setFilter] = useState<TaskStatus | "all">("all");

  useEffect(() => {
    loadTasks({ excludeDeleted: true });
  }, [loadTasks]);

  const filteredTasks = tasks.filter((task) => {
    if (task.deleted_at) return false;
    if (filter === "all") return task.status !== "cancelled";
    return task.status === filter;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="text-blue-600" />
          <h2 className="text-base font-semibold text-gray-800">待办事项</h2>
          {tasks.filter((t) => t.status === "todo" && !t.deleted_at).length > 0 && (
            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {tasks.filter((t) => t.status === "todo" && !t.deleted_at).length}
            </span>
          )}
        </div>
        <button
          onClick={() => openTaskForm()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={15} />
          新建
        </button>
      </div>

      {/* Filters */}
      <div className="px-4 py-2 border-b border-gray-100">
        <TodoFilters activeFilter={filter} onChange={setFilter} />
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
            加载中...
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <ClipboardList size={36} className="mb-3 opacity-30" />
            <p className="text-sm">
              {filter === "all" ? "还没有任务，点击「新建」开始" : "此筛选下暂无任务"}
            </p>
          </div>
        ) : (
          filteredTasks.map((task) => <TodoItem key={task.id} task={task} />)
        )}
      </div>
    </div>
  );
}
