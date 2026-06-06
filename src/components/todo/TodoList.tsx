import { useEffect, useState } from "react";
import { Plus, ClipboardList } from "lucide-react";
import { useTaskStore } from "@/store/taskStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useUiStore } from "@/store/uiStore";
import type { TodoFilterValue } from "@/store/uiStore";
import { TodoItem } from "./TodoItem";
import { TodoFilters } from "./TodoFilters";
import type { Task } from "@/types/task.types";
import type { TimeBlock } from "@/types/timeblock.types";

/** 根据任务与今日时间块的关系计算排序权重（越小越靠前） */
function taskSortWeight(task: Task, todayBlocks: TimeBlock[], nowIso: string): number {
  const taskBlocks = todayBlocks.filter((b) => b.task_id === task.id && !b.deleted_at);
  // 当前正在进行中的块
  const isActive = taskBlocks.some(
    (b) =>
      (b.status === "in_progress" || b.status === "scheduled") &&
      b.start_time <= nowIso &&
      b.end_time > nowIso
  );
  if (isActive) return 0;
  // 今日即将开始的块
  const hasUpcoming = taskBlocks.some((b) => b.status === "scheduled" && b.start_time > nowIso);
  if (hasUpcoming) return 1;
  // deferred 排到后面
  if (task.status === "deferred") return 3;
  return 2;
}

function applyFilter(
  tasks: Task[],
  filter: TodoFilterValue,
  todayBlocks: TimeBlock[],
  nowIso: string,
  allBlocks: TimeBlock[]
): Task[] {
  return tasks
    .filter((task) => {
      if (task.deleted_at) return false;
      if (task.status === "cancelled") return false;

      switch (filter) {
        case "all":
          // "All" shows active tasks only — excludes archived and done
          return (
            !task.archived_at &&
            task.status !== "archived" &&
            task.status !== "done"
          );
        case "todo": {
          if (task.status !== "todo" || task.archived_at) return false;
          // Inbox: exclude tasks that have any future scheduled block (they belong in Planned)
          const hasFutureBlock = allBlocks.some(
            (b) =>
              b.task_id === task.id &&
              !b.deleted_at &&
              (b.status === "scheduled" || b.status === "in_progress") &&
              b.start_time > nowIso
          );
          return !hasFutureBlock;
        }
        case "planned": {
          if (task.archived_at || task.status === "archived") return false;
          if (["in_progress", "deferred"].includes(task.status)) return true;
          // Planned: any task with a future active block (cross-day)
          const hasFutureBlock = allBlocks.some(
            (b) =>
              b.task_id === task.id &&
              !b.deleted_at &&
              (b.status === "scheduled" || b.status === "in_progress") &&
              b.start_time > nowIso
          );
          return hasFutureBlock || task.status === "scheduled";
        }
        case "in_progress": {
          if (task.status === "in_progress") return true;
          return todayBlocks.some(
            (b) =>
              b.task_id === task.id &&
              !b.deleted_at &&
              (b.status === "in_progress" || b.status === "scheduled") &&
              b.start_time <= nowIso &&
              b.end_time > nowIso
          );
        }
        case "deferred":
          return task.status === "deferred" && !task.archived_at;
        case "done":
          return task.status === "done" && !task.archived_at;
        case "archived":
          return !!(task.archived_at || task.status === "archived");
        default:
          return true;
      }
    })
    .sort((a, b) => taskSortWeight(a, todayBlocks, nowIso) - taskSortWeight(b, todayBlocks, nowIso));
}

/** 今日相关任务：用于 TodayPage 精简视图 */
function applyTodayFilter(tasks: Task[], todayBlocks: TimeBlock[], nowIso: string): Task[] {
  const today = new Date(nowIso);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

  return tasks
    .filter((task) => {
      if (task.deleted_at) return false;
      if (task.archived_at || task.status === "archived") return false;
      if (task.status === "cancelled") return false;
      if (task.status === "done") return false;

      // 有今日 TimeBlock
      const hasTodayBlock = todayBlocks.some(
        (b) => b.task_id === task.id && !b.deleted_at
      );
      if (hasTodayBlock) return true;

      // 进行中任务
      if (task.status === "in_progress") return true;

      // 今日截止的待办任务
      if (task.status === "todo" && task.deadline) {
        return task.deadline >= todayStart && task.deadline < todayEnd;
      }

      return false;
    })
    .sort((a, b) => taskSortWeight(a, todayBlocks, nowIso) - taskSortWeight(b, todayBlocks, nowIso));
}

interface TodoListProps {
  /** "full"（默认）：完整筛选器 + 全量任务；"today"：今日相关任务，隐藏筛选器 */
  variant?: "full" | "today";
}

export function TodoList({ variant = "full" }: TodoListProps) {
  const { tasks, isLoading, loadTasks } = useTaskStore();
  const blocks = useTimeBlockStore((state) => state.blocks);
  const currentDate = useTimeBlockStore((state) => state.currentDate);
  const { openTaskForm, todoFilter, setTodoFilter } = useUiStore();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (todoFilter === "archived") {
      loadTasks({ excludeDeleted: true, includeArchived: true });
    } else {
      loadTasks({ excludeDeleted: true });
    }
  }, [loadTasks, todoFilter]);

  // 今日时间块（供每个 TodoItem 查询关联状态）
  const todayBlocks = blocks.filter((b) => {
    if (b.deleted_at) return false;
    const d = new Date(b.start_time);
    return (
      d.getFullYear() === currentDate.getFullYear() &&
      d.getMonth() === currentDate.getMonth() &&
      d.getDate() === currentDate.getDate()
    );
  });

  const nowIso = now.toISOString();

  const filteredTasks =
    variant === "today"
      ? applyTodayFilter(tasks, todayBlocks, nowIso)
      : applyFilter(tasks, todoFilter, todayBlocks, nowIso, blocks);

  const isToday = variant === "today";
  const title = isToday ? "今日待办" : "待办事项";
  const emptyText = isToday
    ? "今日暂无相关任务"
    : todoFilter === "all"
      ? "还没有任务，点击「新建」开始"
      : "此筛选下暂无任务";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="text-blue-600" />
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          {tasks.filter((t) => t.status === "todo" && !t.deleted_at && !t.archived_at).length > 0 && (
            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {tasks.filter((t) => t.status === "todo" && !t.deleted_at && !t.archived_at).length}
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

      {/* Filters — only shown in "full" variant */}
      {!isToday && (
        <div className="px-4 py-2 border-b border-gray-100">
          <TodoFilters activeFilter={todoFilter} onChange={setTodoFilter} />
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
            加载中...
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <ClipboardList size={36} className="mb-3 opacity-30" />
            <p className="text-sm">{emptyText}</p>
          </div>
        ) : (
          filteredTasks.map((task) => (
            <TodoItem key={task.id} task={task} todayBlocks={todayBlocks} now={now} />
          ))
        )}
      </div>
    </div>
  );
}
