import { useEffect } from "react";
import { TodayTimeline } from "@/components/timeline/TodayTimeline";
import { TodaySections } from "@/components/today/TodaySections";
import { HeartbeatPanel } from "@/components/heartbeat/HeartbeatPanel";
import { ExecutionFeedbackDialog } from "@/components/heartbeat/ExecutionFeedbackDialog";
import { DelayChoiceDialog } from "@/components/heartbeat/DelayChoiceDialog";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useHeartbeatStore } from "@/store/heartbeatStore";

export function TodayPage() {
  const { setCurrentDate, delayBlockWithLinkage } = useTimeBlockStore();
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
    <div className="flex h-full overflow-hidden bg-white">
      {/* Today execution view: Heartbeat + TodaySections + Timeline */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <HeartbeatPanel />
        <TodaySections />
        <TodayTimeline />
      </div>

      {/* Global feedback dialog */}
      <ExecutionFeedbackDialog />
      <DelayChoiceDialog
        open={isDelayDialogOpen}
        block={delayTargetBlock}
        onClose={closeDelayDialog}
        onDelayLater={async (blockId) => {
          await delayBlockWithLinkage(blockId);
        }}
        onSuccess={async () => undefined}
      />
    </div>
  );
}
