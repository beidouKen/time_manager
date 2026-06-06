import { CheckCircle2, Clock3, PlayCircle, RotateCcw, SkipForward } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import { useTaskStore } from "@/store/taskStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { formatTime } from "@/lib/dateUtils";
import type { Task } from "@/types/task.types";
import type { TimeBlock } from "@/types/timeblock.types";

/** 每隔 intervalMs 毫秒返回一个新的 Date，用于让组件感知时间流逝 */
function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function isSameLocalDay(iso: string | undefined, day: Date): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  );
}

function hasTodayActiveBlock(taskId: string, blocks: TimeBlock[], day: Date): boolean {
  return blocks.some(
    (block) =>
      block.task_id === taskId &&
      (block.status === "scheduled" || block.status === "in_progress") &&
      isSameLocalDay(block.start_time, day)
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof PlayCircle;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 border-r border-gray-100 px-3 py-2 last:border-r-0">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1.5">
        <Icon size={13} />
        <span>{title}</span>
        {count !== undefined && count > 0 && (
          <span className="ml-auto text-[10px] font-semibold bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5 leading-none">
            {count}
          </span>
        )}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function BlockLine({ block }: { block: TimeBlock }) {
  return (
    <div className="truncate text-xs text-gray-700">
      <span className="text-gray-400">{formatTime(block.start_time)}</span> {block.title}
    </div>
  );
}

function TaskLine({ task }: { task: Task }) {
  return <div className="truncate text-xs text-gray-700">{task.title}</div>;
}

function EmptyLine() {
  return <div className="text-xs text-gray-300">暂无</div>;
}

export function TodaySections() {
  const tasks = useTaskStore((state) => state.tasks);
  const blocks = useTimeBlockStore((state) => state.blocks);
  const currentDate = useTimeBlockStore((state) => state.currentDate);
  // 每 30s 刷新一次，确保「进行中」/「即将开始」分组随当前时间动态变化
  const now = useNow(30_000);
  const nowIso = now.toISOString();

  const visibleTasks = tasks.filter((task) => !task.deleted_at && !task.archived_at);
  const todayBlocks = blocks.filter((block) => !block.deleted_at && isSameLocalDay(block.start_time, currentDate));

  const currentBlocks = todayBlocks.filter(
    (block) =>
      block.status === "in_progress" &&
      block.start_time <= nowIso &&
      block.end_time > nowIso
  );
  const upcomingBlocks = todayBlocks.filter(
    (block) => block.status === "scheduled" && block.start_time > nowIso
  );
  const dueTodoTasks = visibleTasks.filter(
    (task) =>
      task.status === "todo" &&
      isSameLocalDay(task.deadline, currentDate) &&
      !hasTodayActiveBlock(task.id, todayBlocks, currentDate)
  );
  const completedTasks = visibleTasks.filter(
    (task) => task.status === "done" && isSameLocalDay(task.completed_at, currentDate)
  );
  const completedBlocks = todayBlocks.filter((block) => block.status === "done");
  const skippedOrDelayedBlocks = todayBlocks.filter(
    (block) => block.status === "skipped" || block.status === "delayed"
  );
  const deferredTasks = visibleTasks.filter(
    (task) => task.status === "deferred" && isSameLocalDay(task.deferred_until, currentDate)
  );

  return (
    <div className="grid grid-cols-5 border-b border-gray-100 bg-white">
      <Section icon={PlayCircle} title="进行中" count={currentBlocks.length}>
        {currentBlocks.slice(0, 3).map((block) => <BlockLine key={block.id} block={block} />)}
        {currentBlocks.length === 0 && <EmptyLine />}
      </Section>
      <Section icon={Clock3} title="即将开始" count={upcomingBlocks.length}>
        {upcomingBlocks.slice(0, 3).map((block) => <BlockLine key={block.id} block={block} />)}
        {upcomingBlocks.length === 0 && <EmptyLine />}
      </Section>
      <Section icon={RotateCcw} title="今日待处理" count={dueTodoTasks.length}>
        {dueTodoTasks.slice(0, 3).map((task) => <TaskLine key={task.id} task={task} />)}
        {dueTodoTasks.length === 0 && <EmptyLine />}
      </Section>
      <Section icon={CheckCircle2} title="已完成" count={completedTasks.length + completedBlocks.length}>
        {completedTasks.slice(0, 2).map((task) => <TaskLine key={task.id} task={task} />)}
        {completedBlocks.slice(0, Math.max(0, 3 - completedTasks.length)).map((block) => (
          <BlockLine key={block.id} block={block} />
        ))}
        {completedTasks.length + completedBlocks.length === 0 && <EmptyLine />}
      </Section>
      <Section icon={SkipForward} title="跳过/延后" count={skippedOrDelayedBlocks.length + deferredTasks.length}>
        {skippedOrDelayedBlocks.slice(0, 2).map((block) => <BlockLine key={block.id} block={block} />)}
        {deferredTasks.slice(0, Math.max(0, 3 - skippedOrDelayedBlocks.length)).map((task) => (
          <TaskLine key={task.id} task={task} />
        ))}
        {skippedOrDelayedBlocks.length + deferredTasks.length === 0 && <EmptyLine />}
      </Section>
    </div>
  );
}
