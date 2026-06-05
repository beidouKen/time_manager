import { cn } from "@/lib/utils";
import type { TodoFilterValue } from "@/store/uiStore";

const FILTER_OPTIONS: { value: TodoFilterValue; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "todo", label: "待办" },
  { value: "planned", label: "已排期" },
  { value: "in_progress", label: "进行中" },
  { value: "deferred", label: "已延期" },
  { value: "done", label: "已完成" },
  { value: "archived", label: "已归档" },
];

interface TodoFiltersProps {
  activeFilter: TodoFilterValue;
  onChange: (filter: TodoFilterValue) => void;
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
