import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { HeartbeatService } from "@/services/HeartbeatService";
import { TimeBlockService } from "@/services/TimeBlockService";
import { ActionLogService } from "@/services/ActionLogService";
import { DEFAULT_HEARTBEAT_SETTINGS } from "@/types/heartbeat.types";
import type { HeartbeatSettings } from "@/types/heartbeat.types";
import type { TimeBlock } from "@/types/timeblock.types";

// 模块级单例，避免每次 action 重复 new
const timeBlockService = new TimeBlockService();
const heartbeatService = new HeartbeatService();
const actionLogService = new ActionLogService();

// ─── 日志辅助 ──────────────────────────────────────────────────────────────

/**
 * 为 Heartbeat UI 触发的操作写入 agent_action_logs。
 *
 * detected_intent 使用 heartbeat_* 前缀字符串（不进入 IntentType 枚举），
 * user_input 使用 "[heartbeat:action] blockTitle" 格式便于日志检索。
 */
async function logHeartbeatAction(
  action: string,
  block: TimeBlock,
  success: boolean,
  errorMsg?: string
): Promise<void> {
  try {
    const intentStr = `heartbeat_${action}`;
    const userInput = `[heartbeat:${action}] ${block.title}`;
    const log = await actionLogService.logRequest(userInput, intentStr);
    await actionLogService.logToolExecution(log.id, intentStr, {
      blockId: block.id,
      taskId: block.task_id ?? null,
    });
    if (success) {
      await actionLogService.logSuccess(log.id, {
        blockId: block.id,
        action,
        taskId: block.task_id ?? null,
      });
    } else {
      await actionLogService.logFailure(log.id, errorMsg ?? "操作失败");
    }
  } catch (e) {
    // 日志写入失败不应阻断主流程
    console.warn("[Heartbeat] 日志写入失败:", e);
  }
}

// ─── 状态定义 ─────────────────────────────────────────────────────────────

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
  updateSettings: (patch: Partial<HeartbeatSettings>) => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
  tick: () => Promise<void>;
  closeFeedbackDialog: () => void;
  startBlock: (blockId: string) => Promise<void>;
  completeBlock: (blockId: string, feedbackNote?: string) => Promise<void>;
  skipBlock: (blockId: string, feedbackNote?: string) => Promise<void>;
  delayBlock: (blockId: string, feedbackNote?: string) => Promise<void>;
}

type HeartbeatState = HeartbeatSettingsState & HeartbeatRuntimeState & HeartbeatActions;

// ─── Store 定义 ───────────────────────────────────────────────────────────

export const useHeartbeatStore = create<HeartbeatState>()(
  persist(
    (set, get) => ({
      // 设置（持久化）
      ...DEFAULT_HEARTBEAT_SETTINGS,

      // 运行时状态（不持久化）
      currentFocusBlock: null,
      upcomingReminderBlock: null,
      startPromptBlock: null,
      pendingFeedbackBlock: null,
      isFeedbackDialogOpen: false,
      lastTickAt: null,
      _intervalId: null,

      // ─── 设置管理 ────────────────────────────────────────────────────────

      updateSettings: (patch) => {
        set(patch);
      },

      // ─── Timer 管理 ──────────────────────────────────────────────────────

      startHeartbeat: () => {
        const { _intervalId, heartbeatIntervalSeconds, tick } = get();
        if (_intervalId !== null) return;
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

      // ─── 主检查循环 ──────────────────────────────────────────────────────

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

          set({
            currentFocusBlock: evaluation.currentFocusBlock,
            upcomingReminderBlock: evaluation.upcomingReminderBlock,
            startPromptBlock: evaluation.startPromptBlock,
            pendingFeedbackBlock: evaluation.pendingFeedbackBlock,
            lastTickAt: now.toISOString(),
          });

          if (evaluation.upcomingReminderBlock) {
            await heartbeatService.markReminderSent(evaluation.upcomingReminderBlock.id);
          }

          if (evaluation.startPromptBlock) {
            await heartbeatService.markStartPromptSent(evaluation.startPromptBlock.id);
          }

          if (evaluation.pendingFeedbackBlock && autoFeedbackPromptEnabled) {
            await heartbeatService.markEndPromptSent(evaluation.pendingFeedbackBlock.id);
            if (!isFeedbackDialogOpen) {
              set({ isFeedbackDialogOpen: true });
            }
          }
        } catch (e) {
          console.error("[Heartbeat] tick 失败:", e);
        }
      },

      // ─── 反馈对话框 ──────────────────────────────────────────────────────

      closeFeedbackDialog: () => {
        set({ isFeedbackDialogOpen: false, pendingFeedbackBlock: null });
      },

      // ─── 执行操作（含 ActionLog 记录） ───────────────────────────────────

      startBlock: async (blockId) => {
        // 优先从运行时状态取 block 信息，用于日志记录
        const block: TimeBlock =
          get().currentFocusBlock?.id === blockId
            ? get().currentFocusBlock!
            : ({ id: blockId, title: blockId, task_id: null } as unknown as TimeBlock);

        let success = true;
        let errorMsg: string | undefined;
        try {
          await heartbeatService.startBlock(blockId);
        } catch (e) {
          success = false;
          errorMsg = String(e);
          throw e;
        } finally {
          await logHeartbeatAction("start_block", block, success, errorMsg);
        }
        await get().tick();
      },

      completeBlock: async (blockId, feedbackNote) => {
        const block: TimeBlock =
          (get().currentFocusBlock?.id === blockId ? get().currentFocusBlock : null) ??
          (get().pendingFeedbackBlock?.id === blockId ? get().pendingFeedbackBlock : null) ??
          ({ id: blockId, title: blockId, task_id: null } as unknown as TimeBlock);

        let success = true;
        let errorMsg: string | undefined;
        try {
          await heartbeatService.completeBlock(blockId, feedbackNote);
          set({ isFeedbackDialogOpen: false, pendingFeedbackBlock: null });
        } catch (e) {
          success = false;
          errorMsg = String(e);
          throw e;
        } finally {
          await logHeartbeatAction("complete_block", block, success, errorMsg);
        }
        await get().tick();
      },

      skipBlock: async (blockId, feedbackNote) => {
        const block: TimeBlock =
          (get().currentFocusBlock?.id === blockId ? get().currentFocusBlock : null) ??
          (get().pendingFeedbackBlock?.id === blockId ? get().pendingFeedbackBlock : null) ??
          ({ id: blockId, title: blockId, task_id: null } as unknown as TimeBlock);

        let success = true;
        let errorMsg: string | undefined;
        try {
          await heartbeatService.skipBlock(blockId, feedbackNote);
          set({ isFeedbackDialogOpen: false, pendingFeedbackBlock: null });
        } catch (e) {
          success = false;
          errorMsg = String(e);
          throw e;
        } finally {
          await logHeartbeatAction("skip_block", block, success, errorMsg);
        }
        await get().tick();
      },

      delayBlock: async (blockId, feedbackNote) => {
        const block: TimeBlock =
          (get().currentFocusBlock?.id === blockId ? get().currentFocusBlock : null) ??
          (get().pendingFeedbackBlock?.id === blockId ? get().pendingFeedbackBlock : null) ??
          ({ id: blockId, title: blockId, task_id: null } as unknown as TimeBlock);

        let success = true;
        let errorMsg: string | undefined;
        try {
          await heartbeatService.delayBlock(blockId, feedbackNote);
          set({ isFeedbackDialogOpen: false, pendingFeedbackBlock: null });
        } catch (e) {
          success = false;
          errorMsg = String(e);
          throw e;
        } finally {
          await logHeartbeatAction("delay_block", block, success, errorMsg);
        }
        await get().tick();
      },
    }),
    {
      name: "heartbeat-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        heartbeatEnabled: state.heartbeatEnabled,
        reminderBeforeMinutes: state.reminderBeforeMinutes,
        heartbeatIntervalSeconds: state.heartbeatIntervalSeconds,
        autoFeedbackPromptEnabled: state.autoFeedbackPromptEnabled,
      }),
    }
  )
);
