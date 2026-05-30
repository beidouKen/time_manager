import { create } from "zustand";
import { TimeBlockService } from "@/services/TimeBlockService";
import { ScheduleService } from "@/services/ScheduleService";
import type { TimeBlock, CreateTimeBlockInput, UpdateTimeBlockInput } from "@/types/timeblock.types";
import { startOfDay } from "date-fns";

const timeBlockService = new TimeBlockService();
const scheduleService = new ScheduleService();

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
  })
);
