import { useEffect } from "react";
import { CalendarClock } from "lucide-react";
import { TodoItem } from "@/components/todo/TodoItem";
import { useTaskStore } from "@/store/taskStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { formatDate } from "@/lib/dateUtils";

export function PlannedView() {
  const { tasks, loadTasks, isLoading } = useTaskStore();
  const { blocks, refreshBlocks } = useTimeBlockStore();

  useEffect(() => {
    loadTasks({ excludeDeleted: true });
    refreshBlocks();
  }, [loadTasks, refreshBlocks]);

  const futureBlockByTask = new Map<string, string>();
  const nowIso = new Date().toISOString();
  blocks
    .filter(
      (block) =>
        block.task_id &&
        !block.deleted_at &&
        (block.status === "scheduled" || block.status === "in_progress") &&
        block.start_time >= nowIso
    )
    .forEach((block) => {
      const current = futureBlockByTask.get(block.task_id!);
      if (!current || block.start_time < current) {
        futureBlockByTask.set(block.task_id!, block.start_time);
      }
    });

  const plannedTasks = tasks
    .filter(
      (task) =>
        !task.deleted_at &&
        !task.archived_at &&
        (task.status === "scheduled" ||
          task.status === "in_progress" ||
          task.status === "deferred" ||
          futureBlockByTask.has(task.id))
    )
    .sort((a, b) => {
      const aKey = a.deadline ?? futureBlockByTask.get(a.id) ?? a.updated_at;
      const bKey = b.deadline ?? futureBlockByTask.get(b.id) ?? b.updated_at;
      return aKey.localeCompare(bKey);
    });

  return (
    <div className="h-full overflow-hidden bg-white flex flex-col">
      <header className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        <CalendarClock size={18} className="text-blue-600" />
        <h1 className="text-base font-semibold text-gray-900">Planned</h1>
        <span className="text-xs text-gray-400">{plannedTasks.length}</span>
      </header>
      <main className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading ? (
          <div className="text-sm text-gray-400 py-10 text-center">加载中...</div>
        ) : plannedTasks.length === 0 ? (
          <div className="text-sm text-gray-400 py-10 text-center">暂无计划任务</div>
        ) : (
          plannedTasks.map((task) => (
            <div key={task.id} className="space-y-1">
              <TodoItem task={task} />
              {futureBlockByTask.has(task.id) && (
                <div className="pl-10 text-xs text-gray-400">
                  最近安排：{formatDate(futureBlockByTask.get(task.id)!, "MM-dd HH:mm")}
                </div>
              )}
            </div>
          ))
        )}
      </main>
    </div>
  );
}
