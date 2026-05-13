import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/types/task.types";

const FILTER_OPTIONS: { value: TaskStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "todo", label: "待办" },
  { value: "scheduled", label: "已排期" },
  { value: "in_progress", label: "进行中" },
  { value: "done", label: "已完成" },
];

interface TodoFiltersProps {
  activeFilter: TaskStatus | "all";
  onChange: (filter: TaskStatus | "all") => void;
}

export function TodoFilters({ activeFilter, onChange }: TodoFiltersProps) {
  return (
    <div className="flex gap-1 flex-wrap">
      {FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1 text-xs rounded-full transition-colors",
            activeFilter === opt.value
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
