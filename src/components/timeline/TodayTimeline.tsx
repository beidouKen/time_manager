import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Plus, Clock } from "lucide-react";
import { addDays, subDays, isToday, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useUiStore } from "@/store/uiStore";
import { TimeRuler } from "./TimeRuler";
import { TimeBlockCard } from "./TimeBlockCard";
import { HOUR_HEIGHT } from "@/lib/dateUtils";
import { startOfDay } from "date-fns";

const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;

export function TodayTimeline() {
  const { blocks, currentDate, setCurrentDate, isLoading } = useTimeBlockStore();
  const { openTimeBlockForm } = useUiStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current && isToday(currentDate)) {
      const now = new Date();
      const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
      const scrollTop = (minutesSinceMidnight / 60) * HOUR_HEIGHT - 100;
      scrollRef.current.scrollTop = Math.max(0, scrollTop);
    }
  }, [currentDate]);

  const dayStart = startOfDay(currentDate);
  const totalHeight = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT;

  // Current time indicator
  const now = new Date();
  const isCurrentDay = isToday(currentDate);
  const currentTimeTop =
    isCurrentDay
      ? ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT
      : -1;

  const navigatePrev = () => setCurrentDate(subDays(currentDate, 1));
  const navigateNext = () => setCurrentDate(addDays(currentDate, 1));
  const navigateToday = () => setCurrentDate(new Date());

  const dateLabel = format(currentDate, "M月d日 EEEE", { locale: zhCN });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-blue-600" />
          <h2 className="text-base font-semibold text-gray-800">今日日程</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={navigatePrev}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={navigateToday}
            className="px-3 py-1 text-sm text-gray-700 font-medium hover:bg-gray-100 rounded transition-colors"
          >
            {dateLabel}
            {isCurrentDay && (
              <span className="ml-1.5 text-xs text-blue-600 font-medium">今天</span>
            )}
          </button>
          <button
            onClick={navigateNext}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => openTimeBlockForm()}
            className="flex items-center gap-1.5 ml-2 px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Plus size={15} />
            添加
          </button>
        </div>
      </div>

      {/* Timeline scroll container */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            加载中...
          </div>
        ) : (
          <div
            className="relative"
            style={{ height: totalHeight, minHeight: totalHeight }}
          >
            {/* Time ruler */}
            <div className="absolute inset-0">
              <TimeRuler startHour={DAY_START_HOUR} endHour={DAY_END_HOUR} />
            </div>

            {/* Current time indicator */}
            {isCurrentDay && currentTimeTop > 0 && (
              <div
                className="absolute left-14 right-2 z-20 flex items-center gap-1 pointer-events-none"
                style={{ top: currentTimeTop }}
              >
                <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 -ml-1" />
                <div className="flex-1 border-t-2 border-red-400 border-dashed" />
              </div>
            )}

            {/* Time blocks */}
            {blocks.map((block) => (
              <TimeBlockCard
                key={block.id}
                block={block}
                dayStart={dayStart}
              />
            ))}

            {/* Empty state */}
            {blocks.length === 0 && !isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 pointer-events-none">
                <Clock size={36} className="mb-2 opacity-20" />
                <p className="text-sm opacity-50">暂无日程，从 Todo 安排或点击「添加」</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
