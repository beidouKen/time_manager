import { useEffect } from "react";
import { TodayTimeline } from "@/components/timeline/TodayTimeline";
import { useTimeBlockStore } from "@/store/timeBlockStore";

export function TimelinePage() {
  const { setCurrentDate } = useTimeBlockStore();

  useEffect(() => {
    setCurrentDate(new Date());
  }, [setCurrentDate]);

  return (
    <div className="flex h-full overflow-hidden bg-white">
      <div className="flex-1 overflow-hidden flex flex-col">
        <TodayTimeline />
      </div>
    </div>
  );
}
