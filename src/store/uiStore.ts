import { create } from "zustand";

interface UiState {
  // Task form
  taskFormOpen: boolean;
  editingTaskId: string | null;

  // Schedule dialog
  scheduleDialogOpen: boolean;
  scheduleForTaskId: string | null;
  scheduleForTaskTitle: string | null;

  // TimeBlock form
  timeBlockFormOpen: boolean;
  editingBlockId: string | null;

  // Sidebar
  activePage: "today" | "settings";
}

interface UiActions {
  openTaskForm: (taskId?: string) => void;
  closeTaskForm: () => void;
  openScheduleDialog: (taskId: string, taskTitle: string) => void;
  closeScheduleDialog: () => void;
  openTimeBlockForm: (blockId?: string) => void;
  closeTimeBlockForm: () => void;
  setActivePage: (page: UiState["activePage"]) => void;
}

export const useUiStore = create<UiState & UiActions>((set) => ({
  taskFormOpen: false,
  editingTaskId: null,
  scheduleDialogOpen: false,
  scheduleForTaskId: null,
  scheduleForTaskTitle: null,
  timeBlockFormOpen: false,
  editingBlockId: null,
  activePage: "today",

  openTaskForm: (taskId) =>
    set({ taskFormOpen: true, editingTaskId: taskId ?? null }),
  closeTaskForm: () =>
    set({ taskFormOpen: false, editingTaskId: null }),

  openScheduleDialog: (taskId, taskTitle) =>
    set({
      scheduleDialogOpen: true,
      scheduleForTaskId: taskId,
      scheduleForTaskTitle: taskTitle,
    }),
  closeScheduleDialog: () =>
    set({
      scheduleDialogOpen: false,
      scheduleForTaskId: null,
      scheduleForTaskTitle: null,
    }),

  openTimeBlockForm: (blockId) =>
    set({ timeBlockFormOpen: true, editingBlockId: blockId ?? null }),
  closeTimeBlockForm: () =>
    set({ timeBlockFormOpen: false, editingBlockId: null }),

  setActivePage: (page) => set({ activePage: page }),
}));
