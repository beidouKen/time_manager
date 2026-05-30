import { useEffect } from "react";
import { TodoList } from "@/components/todo/TodoList";
import { TodayTimeline } from "@/components/timeline/TodayTimeline";
import { useTimeBlockStore } from "@/store/timeBlockStore";

export function TodayPage() {
  const { setCurrentDate } = useTimeBlockStore();

  useEffect(() => {
    setCurrentDate(new Date());
  }, [setCurrentDate]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Todo panel */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white overflow-hidden flex flex-col">
        <TodoList />
      </div>

      {/* Right: Timeline panel */}
      <div className="flex-1 overflow-hidden flex flex-col bg-white">
        <TodayTimeline />
      </div>
    </div>
  );
}
