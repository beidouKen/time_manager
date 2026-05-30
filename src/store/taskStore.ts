import { create } from "zustand";
import { TaskService } from "@/services/TaskService";
import { ScheduleService } from "@/services/ScheduleService";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import type { Task, CreateTaskInput, UpdateTaskInput, TaskFilter } from "@/types/task.types";
import type { ScheduleTaskInput } from "@/services/ScheduleService";

const taskService = new TaskService();
const scheduleService = new ScheduleService();

interface TaskState {
  tasks: Task[];
  isLoading: boolean;
  error: string | null;
}

interface TaskActions {
  loadTasks: (filter?: TaskFilter) => Promise<void>;
  addTask: (input: CreateTaskInput) => Promise<Task>;
  updateTask: (id: string, patch: UpdateTaskInput) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  scheduleTask: (input: ScheduleTaskInput) => Promise<void>;
  clearError: () => void;
}

export const useTaskStore = create<TaskState & TaskActions>((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,

  loadTasks: async (filter) => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await taskService.getTasks(filter);
      set({ tasks, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  addTask: async (input) => {
    set({ error: null });
    const task = await taskService.createTask(input);
    set((s) => ({ tasks: [task, ...s.tasks] }));
    return task;
  },

  updateTask: async (id, patch) => {
    set({ error: null });
    const updated = await taskService.updateTask(id, patch);
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? updated : t)),
    }));
    return updated;
  },

  deleteTask: async (id) => {
    set({ error: null });
    await taskService.deleteTask(id);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    // Refresh timeline to remove blocks that were soft-deleted along with the task
    await useTimeBlockStore.getState().refreshBlocks();
  },

  scheduleTask: async (input) => {
    set({ error: null });
    await scheduleService.scheduleTaskToTimeBlock(input);
    // Reload to get fresh task status
    await get().loadTasks();
  },

  clearError: () => set({ error: null }),
}));
