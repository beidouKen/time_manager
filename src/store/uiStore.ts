import { create } from "zustand";

export type TodoFilterValue =
  | "all"
  | "todo"
  | "planned"
  | "in_progress"
  | "deferred"
  | "done"
  | "archived";

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

  // Sidebar — 5 application-level pages
  activePage: "today" | "todo" | "timeline" | "chat" | "settings";

  // TodoPage filter (persisted across page switches)
  todoFilter: TodoFilterValue;
}

interface UiActions {
  openTaskForm: (taskId?: string) => void;
  closeTaskForm: () => void;
  openScheduleDialog: (taskId: string, taskTitle: string) => void;
  closeScheduleDialog: () => void;
  openTimeBlockForm: (blockId?: string) => void;
  closeTimeBlockForm: () => void;
  setActivePage: (page: UiState["activePage"]) => void;
  setTodoFilter: (filter: TodoFilterValue) => void;
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
  todoFilter: "all",

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
  setTodoFilter: (filter) => set({ todoFilter: filter }),
}));
