import { useEffect } from "react";
import { TodoList } from "@/components/todo/TodoList";
import { TodayTimeline } from "@/components/timeline/TodayTimeline";
import { TodaySections } from "@/components/today/TodaySections";
import { HeartbeatPanel } from "@/components/heartbeat/HeartbeatPanel";
import { ExecutionFeedbackDialog } from "@/components/heartbeat/ExecutionFeedbackDialog";
import { DelayChoiceDialog } from "@/components/heartbeat/DelayChoiceDialog";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useHeartbeatStore } from "@/store/heartbeatStore";
import { useTaskStore } from "@/store/taskStore";

export function TodayPage() {
  const { setCurrentDate, delayBlockWithLinkage, refreshBlocks } = useTimeBlockStore();
  const { loadTasks } = useTaskStore();
  const {
    heartbeatEnabled,
    startHeartbeat,
    stopHeartbeat,
    isDelayDialogOpen,
    delayTargetBlock,
    closeDelayDialog,
  } = useHeartbeatStore();

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
      {/* Left: today-focused TodoList (no filters) */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white overflow-hidden flex flex-col">
        <TodoList variant="today" />
      </div>

      {/* Right: Heartbeat + TodaySections + Timeline */}
      <div className="flex-1 overflow-hidden flex flex-col bg-white">
        <HeartbeatPanel />
        <TodaySections />
        <TodayTimeline />
      </div>

      {/* Global feedback dialogs */}
      <ExecutionFeedbackDialog />
      <DelayChoiceDialog
        open={isDelayDialogOpen}
        block={delayTargetBlock}
        onClose={closeDelayDialog}
        onDelayLater={async (blockId) => {
          await delayBlockWithLinkage(blockId);
        }}
        onSuccess={async () => {
          await Promise.all([refreshBlocks(), loadTasks({ excludeDeleted: true })]);
        }}
      />
    </div>
  );
}
