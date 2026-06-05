import type { TimeBlock } from "@/types/timeblock.types";

// ─── Heartbeat 设置 ───────────────────────────────────────────────────────────

export interface HeartbeatSettings {
  heartbeatEnabled: boolean;
  reminderBeforeMinutes: number;
  heartbeatIntervalSeconds: number;
  autoFeedbackPromptEnabled: boolean;
  autoArchiveDays: number;
}

export const DEFAULT_HEARTBEAT_SETTINGS: HeartbeatSettings = {
  heartbeatEnabled: false,
  reminderBeforeMinutes: 5,
  heartbeatIntervalSeconds: 30,
  autoFeedbackPromptEnabled: true,
  autoArchiveDays: 7,
};

// ─── Heartbeat 评估结果 ────────────────────────────────────────────────────────

/**
 * evaluateNow() 的输出，描述当前时刻应触发的 Heartbeat 事件。
 * 每个字段互相独立，tick() 根据各字段决定后续动作。
 */
export interface HeartbeatEvaluation {
  /** 当前正在进行中（或应正在进行中）的 TimeBlock */
  currentFocusBlock: TimeBlock | null;
  /** 即将开始、需要发出提醒的 TimeBlock */
  upcomingReminderBlock: TimeBlock | null;
  /** 到达开始时间、需要发出开始提示的 TimeBlock */
  startPromptBlock: TimeBlock | null;
  /** 已结束、等待用户反馈（Done/Skip/Delay）的 TimeBlock */
  pendingFeedbackBlock: TimeBlock | null;
}
