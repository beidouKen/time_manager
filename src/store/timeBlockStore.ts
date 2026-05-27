import { create } from "zustand";
import { TimeBlockService } from "@/services/TimeBlockService";
import { ScheduleService } from "@/services/ScheduleService";
import { HeartbeatService } from "@/services/HeartbeatService";
import { ActionLogService } from "@/services/ActionLogService";
import type { TimeBlock, CreateTimeBlockInput, UpdateTimeBlockInput } from "@/types/timeblock.types";
import { startOfDay } from "date-fns";

// 模块级单例，避免每次 render 重复 new
const timeBlockService = new TimeBlockService();
const scheduleService = new ScheduleService();
const heartbeatService = new HeartbeatService();
const actionLogService = new ActionLogService();

// ─── 日志辅助（TimeBlock 菜单操作） ──────────────────────────────────────────

async function logTimelineAction(
  action: string,
  block: TimeBlock,
  success: boolean,
  errorMsg?: string
): Promise<void> {
  try {
    const intentStr = `timeline_${action}`;
    const userInput = `[timeline:${action}] ${block.title}`;
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
    console.warn("[Timeline] 日志写入失败:", e);
  }
}

interface TimeBlockState {
  blocks: TimeBlock[];
  currentDate: Date;
  isLoading: boolean;
  error: string | null;
}

interface TimeBlockActions {
  setCurrentDate: (date: Date) => Promise<void>;
  loadBlocksForDate: (date: Date) => Promise<void>;
  addBlock: (input: CreateTimeBlockInput) => Promise<TimeBlock>;
  updateBlock: (id: string, patch: UpdateTimeBlockInput) => Promise<TimeBlock>;
  deleteBlock: (id: string) => Promise<void>;
  updateBlockStatus: (id: string, status: TimeBlock["status"]) => Promise<void>;
  moveBackToTask: (blockId: string) => Promise<{ taskId: string; taskStatusUpdatedTo: string }>;
  refreshBlocks: () => Promise<void>;
  clearError: () => void;
  /**
   * V2.5：从 TimeBlockCard 菜单触发的联动操作。
   * 通过 HeartbeatService 执行状态转换 + Task 状态联动，并写入 ActionLog。
   * 这三个方法与 Heartbeat UI 路径行为完全一致。
   */
  completeBlockWithLinkage: (blockId: string) => Promise<void>;
  skipBlockWithLinkage: (blockId: string) => Promise<void>;
  delayBlockWithLinkage: (blockId: string) => Promise<void>;
}

export const useTimeBlockStore = create<TimeBlockState & TimeBlockActions>(
  (set, get) => ({
    blocks: [],
    currentDate: startOfDay(new Date()),
    isLoading: false,
    error: null,

    setCurrentDate: async (date) => {
      const day = startOfDay(date);
      set({ currentDate: day });
      await get().loadBlocksForDate(day);
    },

    loadBlocksForDate: async (date) => {
      set({ isLoading: true, error: null });
      try {
        const blocks = await timeBlockService.getBlocksForDate(date);
        set({ blocks, isLoading: false });
      } catch (e) {
        set({ isLoading: false, error: String(e) });
      }
    },

    refreshBlocks: async () => {
      await get().loadBlocksForDate(get().currentDate);
    },

    addBlock: async (input) => {
      set({ error: null });
      const block = await timeBlockService.createTimeBlock(input);
      set((s) => ({ blocks: [...s.blocks, block].sort((a, b) =>
        a.start_time.localeCompare(b.start_time)) }));
      return block;
    },

    updateBlock: async (id, patch) => {
      set({ error: null });
      const updated = await timeBlockService.updateTimeBlock(id, patch);
      set((s) => ({
        blocks: s.blocks.map((b) => (b.id === id ? updated : b)),
      }));
      return updated;
    },

    deleteBlock: async (id) => {
      set({ error: null });
      await timeBlockService.deleteTimeBlock(id);
      set((s) => ({ blocks: s.blocks.filter((b) => b.id !== id) }));
    },

    updateBlockStatus: async (id, status) => {
      set({ error: null });
      const updated = await timeBlockService.updateBlockStatus(id, status);
      set((s) => ({
        blocks: s.blocks.map((b) => (b.id === id ? updated : b)),
      }));
    },

    moveBackToTask: async (blockId) => {
      set({ error: null });
      const result = await scheduleService.moveTimeBlockBackToTask(blockId);
      // Remove block from current view
      set((s) => ({ blocks: s.blocks.filter((b) => b.id !== blockId) }));
      return result;
    },

    clearError: () => set({ error: null }),

    // ─── V2.5 联动操作（Task 联动 + ActionLog） ──────────────────────────────

    completeBlockWithLinkage: async (blockId) => {
      set({ error: null });
      const block = get().blocks.find((b) => b.id === blockId);
      if (!block) {
        set({ error: "时间块不存在" });
        return;
      }
      let success = true;
      let errorMsg: string | undefined;
      try {
        await heartbeatService.completeBlock(blockId);
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.id === blockId ? { ...b, status: "done" as const } : b
          ),
        }));
      } catch (e) {
        success = false;
        errorMsg = String(e);
        set({ error: errorMsg });
        throw e;
      } finally {
        await logTimelineAction("complete_block", block, success, errorMsg);
      }
    },

    skipBlockWithLinkage: async (blockId) => {
      set({ error: null });
      const block = get().blocks.find((b) => b.id === blockId);
      if (!block) {
        set({ error: "时间块不存在" });
        return;
      }
      let success = true;
      let errorMsg: string | undefined;
      try {
        await heartbeatService.skipBlock(blockId);
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.id === blockId ? { ...b, status: "skipped" as const } : b
          ),
        }));
      } catch (e) {
        success = false;
        errorMsg = String(e);
        set({ error: errorMsg });
        throw e;
      } finally {
        await logTimelineAction("skip_block", block, success, errorMsg);
      }
    },

    delayBlockWithLinkage: async (blockId) => {
      set({ error: null });
      const block = get().blocks.find((b) => b.id === blockId);
      if (!block) {
        set({ error: "时间块不存在" });
        return;
      }
      let success = true;
      let errorMsg: string | undefined;
      try {
        await heartbeatService.delayBlock(blockId);
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.id === blockId ? { ...b, status: "delayed" as const } : b
          ),
        }));
      } catch (e) {
        success = false;
        errorMsg = String(e);
        set({ error: errorMsg });
        throw e;
      } finally {
        await logTimelineAction("delay_block", block, success, errorMsg);
      }
    },
  })
);
