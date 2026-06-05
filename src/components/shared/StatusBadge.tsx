import { cn } from "@/lib/utils";
import type { TaskStatus, TaskPriority } from "@/types/task.types";
import type { TimeBlockStatus, TimeBlockType } from "@/types/timeblock.types";

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
  todo: { label: "待办", className: "bg-gray-100 text-gray-600" },
  scheduled: { label: "已排期", className: "bg-blue-100 text-blue-700" },
  in_progress: { label: "进行中", className: "bg-yellow-100 text-yellow-700" },
  done: { label: "已完成", className: "bg-green-100 text-green-700" },
  cancelled: { label: "已取消", className: "bg-red-100 text-red-500" },
  archived: { label: "已归档", className: "bg-slate-100 text-slate-600" },
  deferred: { label: "已延期", className: "bg-orange-100 text-orange-700" },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: "低", className: "bg-gray-100 text-gray-500" },
  medium: { label: "中", className: "bg-blue-100 text-blue-600" },
  high: { label: "高", className: "bg-orange-100 text-orange-600" },
  urgent: { label: "紧急", className: "bg-red-100 text-red-600" },
};

const BLOCK_STATUS_CONFIG: Record<TimeBlockStatus, { label: string; className: string }> = {
  scheduled: { label: "待开始", className: "bg-blue-100 text-blue-700" },
  in_progress: { label: "进行中", className: "bg-yellow-100 text-yellow-700" },
  done: { label: "已完成", className: "bg-green-100 text-green-700" },
  skipped: { label: "已跳过", className: "bg-gray-100 text-gray-500" },
  cancelled: { label: "已取消", className: "bg-red-100 text-red-500" },
  delayed: { label: "已延后", className: "bg-orange-100 text-orange-600" },
};

const BLOCK_TYPE_CONFIG: Record<TimeBlockType, { label: string; dotClass: string }> = {
  task: { label: "任务", dotClass: "bg-blue-500" },
  event: { label: "事件", dotClass: "bg-purple-500" },
  break: { label: "休息", dotClass: "bg-green-500" },
  routine: { label: "例程", dotClass: "bg-orange-500" },
};

interface BadgeProps {
  className?: string;
}

export function TaskStatusBadge({
  status,
  className,
}: BadgeProps & { status: TaskStatus }) {
  const config = TASK_STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}

export function PriorityBadge({
  priority,
  className,
}: BadgeProps & { priority: TaskPriority }) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}

export function BlockStatusBadge({
  status,
  className,
}: BadgeProps & { status: TimeBlockStatus }) {
  const config = BLOCK_STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}

export function BlockTypeDot({ type }: { type: TimeBlockType }) {
  const config = BLOCK_TYPE_CONFIG[type];
  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", config.dotClass)}
      title={config.label}
    />
  );
}
