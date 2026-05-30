import { useEffect } from "react";
import { TodoList } from "@/components/todo/TodoList";
import { TodayTimeline } from "@/components/timeline/TodayTimeline";
import { HeartbeatPanel } from "@/components/heartbeat/HeartbeatPanel";
import { ExecutionFeedbackDialog } from "@/components/heartbeat/ExecutionFeedbackDialog";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useHeartbeatStore } from "@/store/heartbeatStore";

export function TodayPage() {
  const { setCurrentDate } = useTimeBlockStore();
  const { heartbeatEnabled, startHeartbeat, stopHeartbeat } = useHeartbeatStore();

  useEffect(() => {
    setCurrentDate(new Date());
  }, [setCurrentDate]);

  // 根据 heartbeatEnabled 设置决定是否启动 Heartbeat timer
  useEffect(() => {
    if (heartbeatEnabled) {
      startHeartbeat();
    }
    return () => {
      stopHeartbeat();
    };
  }, [heartbeatEnabled, startHeartbeat, stopHeartbeat]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Todo panel */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white overflow-hidden flex flex-col">
        <TodoList />
      </div>

      {/* Right: Timeline + Heartbeat panel */}
      <div className="flex-1 overflow-hidden flex flex-col bg-white">
        <HeartbeatPanel />
        <TodayTimeline />
      </div>

      {/* Global feedback dialog */}
      <ExecutionFeedbackDialog />
    </div>
  );
}
