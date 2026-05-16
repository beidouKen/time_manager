import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { HeartbeatService } from "@/services/HeartbeatService";
import { TimeBlockService } from "@/services/TimeBlockService";
import { DEFAULT_HEARTBEAT_SETTINGS } from "@/types/heartbeat.types";
import type { HeartbeatSettings } from "@/types/heartbeat.types";
import type { TimeBlock } from "@/types/timeblock.types";

const timeBlockService = new TimeBlockService();
const heartbeatService = new HeartbeatService();

// ─── 状态定义 ─────────────────────────────────────────────────────────────────

interface HeartbeatSettingsState extends HeartbeatSettings {}

interface HeartbeatRuntimeState {
  currentFocusBlock: TimeBlock | null;
  upcomingReminderBlock: TimeBlock | null;
  startPromptBlock: TimeBlock | null;
  pendingFeedbackBlock: TimeBlock | null;
  isFeedbackDialogOpen: boolean;
  lastTickAt: string | null;
  _intervalId: ReturnType<typeof setInterval> | null;
}

interface HeartbeatActions {
  // 设置
  updateSettings: (patch: Partial<HeartbeatSettings>) => void;
  // Timer 管理
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
  // 主检查循环
  tick: () => Promise<void>;
  // 反馈对话框
  closeFeedbackDialog: () => void;
  // 执行操作（调用 HeartbeatService，完成后刷新调用方负责 Store 刷新）
  startBlock: (blockId: string) => Promise<void>;
  completeBlock: (blockId: string, feedbackNote?: string) => Promise<void>;
  skipBlock: (blockId: string, feedbackNote?: string) => Promise<void>;
  delayBlock: (blockId: string, feedbackNote?: string) => Promise<void>;
}

type HeartbeatState = HeartbeatSettingsState & HeartbeatRuntimeState & HeartbeatActions;

// ─── Store 定义 ───────────────────────────────────────────────────────────────

// 仅持久化设置字段，运行时状态不存 localStorage
export const useHeartbeatStore = create<HeartbeatState>()(
  persist(
    (set, get) => ({
      // 设置（持久化）
      ...DEFAULT_HEARTBEAT_SETTINGS,

      // 运行时状态（不持久化，persist partialize 排除）
      currentFocusBlock: null,
      upcomingReminderBlock: null,
      startPromptBlock: null,
      pendingFeedbackBlock: null,
      isFeedbackDialogOpen: false,
      lastTickAt: null,
      _intervalId: null,

      // ─── 设置管理 ──────────────────────────────────────────────────────────

      updateSettings: (patch) => {
        set(patch);
      },

      // ─── Timer 管理 ────────────────────────────────────────────────────────

      startHeartbeat: () => {
        const { _intervalId, heartbeatIntervalSeconds, tick } = get();

        // 防止重复创建 interval
        if (_intervalId !== null) return;

        // 立即执行一次
        tick();

        const id = setInterval(() => {
          tick();
        }, heartbeatIntervalSeconds * 1000);

        set({ _intervalId: id });
      },

      stopHeartbeat: () => {
        const { _intervalId } = get();
        if (_intervalId !== null) {
          clearInterval(_intervalId);
          set({
            _intervalId: null,
            currentFocusBlock: null,
            upcomingReminderBlock: null,
            startPromptBlock: null,
            pendingFeedbackBlock: null,
          });
        }
      },

      // ─── 主检查循环 ────────────────────────────────────────────────────────

      tick: async () => {
        const {
          heartbeatEnabled,
          reminderBeforeMinutes,
          heartbeatIntervalSeconds,
          autoFeedbackPromptEnabled,
          isFeedbackDialogOpen,
        } = get();

        if (!heartbeatEnabled) return;

        const now = new Date();

        try {
          const blocks = await timeBlockService.getBlocksForDate(now);

          const evaluation = heartbeatService.evaluateNow(blocks, now, {
            heartbeatEnabled,
            reminderBeforeMinutes,
            heartbeatIntervalSeconds,
            autoFeedbackPromptEnabled,
          });

          // 更新运行时状态
          set({
            currentFocusBlock: evaluation.currentFocusBlock,
            upcomingReminderBlock: evaluation.upcomingReminderBlock,
            startPromptBlock: evaluation.startPromptBlock,
            pendingFeedbackBlock: evaluation.pendingFeedbackBlock,
            lastTickAt: now.toISOString(),
          });

          // 写入开始前提醒防重复时间戳
          if (evaluation.upcomingReminderBlock) {
            await heartbeatService.markReminderSent(evaluation.upcomingReminderBlock.id);
          }

          // 写入开始提示防重复时间戳
          if (evaluation.startPromptBlock) {
            await heartbeatService.markStartPromptSent(evaluation.startPromptBlock.id);
          }

          // 写入结束反馈防重复时间戳，并弹出对话框
          if (evaluation.pendingFeedbackBlock && autoFeedbackPromptEnabled) {
            await heartbeatService.markEndPromptSent(evaluation.pendingFeedbackBlock.id);
            // 若对话框已开启则不重复触发
            if (!isFeedbackDialogOpen) {
              set({ isFeedbackDialogOpen: true });
            }
          }
        } catch (e) {
          console.error("[Heartbeat] tick 失败:", e);
        }
      },

      // ─── 反馈对话框 ────────────────────────────────────────────────────────

      closeFeedbackDialog: () => {
        set({ isFeedbackDialogOpen: false, pendingFeedbackBlock: null });
      },

      // ─── 执行操作 ──────────────────────────────────────────────────────────

      startBlock: async (blockId) => {
        await heartbeatService.startBlock(blockId);
        // 立即触发一次 tick，刷新 Heartbeat 状态
        await get().tick();
      },

      completeBlock: async (blockId, feedbackNote) => {
        await heartbeatService.completeBlock(blockId, feedbackNote);
        set({ isFeedbackDialogOpen: false, pendingFeedbackBlock: null });
        await get().tick();
      },

      skipBlock: async (blockId, feedbackNote) => {
        await heartbeatService.skipBlock(blockId, feedbackNote);
        set({ isFeedbackDialogOpen: false, pendingFeedbackBlock: null });
        await get().tick();
      },

      delayBlock: async (blockId, feedbackNote) => {
        await heartbeatService.delayBlock(blockId, feedbackNote);
        set({ isFeedbackDialogOpen: false, pendingFeedbackBlock: null });
        await get().tick();
      },
    }),
    {
      name: "heartbeat-settings",
      storage: createJSONStorage(() => localStorage),
      // 只持久化设置字段，运行时状态不需要持久化
      partialize: (state) => ({
        heartbeatEnabled: state.heartbeatEnabled,
        reminderBeforeMinutes: state.reminderBeforeMinutes,
        heartbeatIntervalSeconds: state.heartbeatIntervalSeconds,
        autoFeedbackPromptEnabled: state.autoFeedbackPromptEnabled,
      }),
    }
  )
);
