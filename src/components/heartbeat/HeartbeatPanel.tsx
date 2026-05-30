import { Bell, BellOff, Clock } from "lucide-react";
import { useHeartbeatStore } from "@/store/heartbeatStore";
import { CurrentFocusCard } from "./CurrentFocusCard";
import { formatTime } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";

export function HeartbeatPanel() {
  const {
    heartbeatEnabled,
    updateSettings,
    currentFocusBlock,
    upcomingReminderBlock,
    startPromptBlock,
    lastTickAt,
  } = useHeartbeatStore();

  // Heartbeat 关闭时只显示一个小开关，不占用空间
  if (!heartbeatEnabled) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50">
        <BellOff size={13} className="text-gray-400" />
        <span className="text-xs text-gray-400">Heartbeat 已关闭</span>
        <button
          onClick={() => updateSettings({ heartbeatEnabled: true })}
          className="ml-auto text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          开启
        </button>
      </div>
    );
  }

  // 需要展示的提醒项（当前焦点优先，其次是 startPrompt、upcomingReminder）
  const activeBlock = currentFocusBlock ?? startPromptBlock;
  const hasReminder = !!upcomingReminderBlock && !activeBlock;

  return (
    <div className="border-b border-gray-100 bg-white">
      {/* 顶栏：状态行 */}
      <div className="flex items-center gap-2 px-4 py-1.5">
        <Bell size={13} className="text-green-500" />
        <span className="text-xs text-gray-500">Heartbeat 运行中</span>
        {lastTickAt && (
          <span className="text-xs text-gray-300 ml-1 flex items-center gap-0.5">
            <Clock size={10} />
            {new Date(lastTickAt).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
        <button
          onClick={() => updateSettings({ heartbeatEnabled: false })}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600"
        >
          关闭
        </button>
      </div>

      {/* 当前焦点卡片 */}
      {activeBlock && (
        <div className="px-4 pb-2">
          <CurrentFocusCard block={activeBlock} />
        </div>
      )}

      {/* 即将开始提醒 */}
      {hasReminder && upcomingReminderBlock && (
        <div className="px-4 pb-2">
          <div
            className={cn(
              "rounded-lg border px-3 py-2 flex items-center gap-2",
              "bg-blue-50 border-blue-200"
            )}
          >
            <Bell size={12} className="text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-blue-800 font-medium truncate">
                即将开始：{upcomingReminderBlock.title}
              </p>
              <p className="text-xs text-blue-500">
                {formatTime(upcomingReminderBlock.start_time)} 开始
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
