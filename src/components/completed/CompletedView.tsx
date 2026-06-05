import { useEffect } from "react";
import { Archive, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PriorityBadge, TaskStatusBadge } from "@/components/shared/StatusBadge";
import { useTaskStore } from "@/store/taskStore";
import { formatDate } from "@/lib/dateUtils";
import type { Task } from "@/types/task.types";

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isThisWeek(date: Date, now: Date): boolean {
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

function groupCompletedTasks(tasks: Task[]) {
  const now = new Date();
  const groups: Array<{ title: string; tasks: Task[] }> = [
    { title: "今天", tasks: [] },
    { title: "本周", tasks: [] },
    { title: "更早", tasks: [] },
  ];

  for (const task of tasks) {
    const completedAt = new Date(task.completed_at ?? task.updated_at);
    if (isSameLocalDay(completedAt, now)) groups[0].tasks.push(task);
    else if (isThisWeek(completedAt, now)) groups[1].tasks.push(task);
    else groups[2].tasks.push(task);
  }

  return groups.filter((group) => group.tasks.length > 0);
}

function CompletedTaskRow({ task }: { task: Task }) {
  const archiveTask = useTaskStore((state) => state.archiveTask);

  const handleArchive = async () => {
    try {
      await archiveTask(task.id);
      toast.success("任务已归档");
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-md border border-gray-200 bg-white">
      <CheckCircle2 size={18} className="text-green-500 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
          <TaskStatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
        </div>
        <p className="text-xs text-gray-400 mt-1">
          完成于 {formatDate(task.completed_at ?? task.updated_at, "MM-dd HH:mm")}
        </p>
      </div>
      <button
        onClick={handleArchive}
        title="归档"
        className="p-1.5 rounded-md text-gray-400 hover:text-slate-700 hover:bg-slate-100"
      >
        <Archive size={16} />
      </button>
    </div>
  );
}

export function CompletedView() {
  const { tasks, loadTasks, isLoading, archiveTask } = useTaskStore();

  useEffect(() => {
    loadTasks({ excludeDeleted: true });
  }, [loadTasks]);

  const completedTasks = tasks
    .filter((task) => task.status === "done" && !task.deleted_at && !task.archived_at)
    .sort((a, b) =>
      (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at)
    );
  const groups = groupCompletedTasks(completedTasks);

  const archiveAll = async () => {
    try {
      for (const task of completedTasks) {
        await archiveTask(task.id);
      }
      toast.success("已归档全部已完成任务");
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="h-full overflow-hidden bg-white flex flex-col">
      <header className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-green-600" />
          <h1 className="text-base font-semibold text-gray-900">Completed</h1>
          <span className="text-xs text-gray-400">{completedTasks.length}</span>
        </div>
        <button
          onClick={archiveAll}
          disabled={completedTasks.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Archive size={15} />
          全部归档
        </button>
      </header>
      <main className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="text-sm text-gray-400 py-10 text-center">加载中...</div>
        ) : completedTasks.length === 0 ? (
          <div className="text-sm text-gray-400 py-10 text-center">暂无已完成任务</div>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.title}>
                <h2 className="text-xs font-semibold text-gray-400 mb-2">{group.title}</h2>
                <div className="space-y-2">
                  {group.tasks.map((task) => (
                    <CompletedTaskRow key={task.id} task={task} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
