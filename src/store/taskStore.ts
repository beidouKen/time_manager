import { create } from "zustand";
import { TaskService } from "@/services/TaskService";
import { ScheduleService } from "@/services/ScheduleService";
import { ArchiveService } from "@/services/ArchiveService";
import { UiActionEventService } from "@/services/UiActionEventService";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import type { Task, CreateTaskInput, UpdateTaskInput, TaskFilter } from "@/types/task.types";
import type { ScheduleTaskInput } from "@/services/ScheduleService";

const taskService = new TaskService();
const scheduleService = new ScheduleService();
const archiveService = new ArchiveService();
const uiActionEventService = new UiActionEventService();

async function recordTaskUiAction(
  taskId: string,
  eventType: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    const { useChatStore } = await import("@/store/chatStore");
    const chat = useChatStore.getState();
    await uiActionEventService.recordUiAction(chat.currentConversationId, {
      entity_type: "task",
      entity_id: taskId,
      event_type: eventType,
      payload,
    });
    await chat.refreshActiveContext?.();
  } catch (e) {
    console.warn("[taskStore] UI action event failed:", e);
  }
}

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
  completeTask: (id: string) => Promise<Task>;
  skipTaskToday: (id: string) => Promise<Task>;
  deferTask: (id: string, until?: string) => Promise<Task>;
  reopenTask: (id: string) => Promise<Task>;
  archiveTask: (id: string) => Promise<Task>;
  unarchiveTask: (id: string) => Promise<Task>;
  batchDeleteTasks: (ids: string[]) => Promise<void>;
  runAutoArchive: (thresholdDays?: number) => Promise<void>;
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
    await recordTaskUiAction(task.id, "create_task", { title: task.title });
    return task;
  },

  updateTask: async (id, patch) => {
    set({ error: null });
    const updated = await taskService.updateTask(id, patch);
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? updated : t)),
    }));
    await recordTaskUiAction(id, "update_task", { patch });
    return updated;
  },

  deleteTask: async (id) => {
    set({ error: null });
    await taskService.deleteTask(id);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    // Refresh timeline to remove blocks that were soft-deleted along with the task
    await useTimeBlockStore.getState().refreshBlocks();
    await recordTaskUiAction(id, "delete_task");
  },

  scheduleTask: async (input) => {
    set({ error: null });
    await scheduleService.scheduleTaskToTimeBlock(input);
    // Reload to get fresh task status
    await Promise.all([get().loadTasks(), useTimeBlockStore.getState().refreshBlocks()]);
    await recordTaskUiAction(input.taskId, "schedule_task", {
      startTime: input.startTime,
      endTime: input.endTime,
    });
  },

  completeTask: async (id) => {
    set({ error: null });
    const task = await taskService.completeTask(id);
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
    await useTimeBlockStore.getState().refreshBlocks();
    await recordTaskUiAction(id, "complete_task");
    return task;
  },

  skipTaskToday: async (id) => {
    set({ error: null });
    const task = await taskService.skipTaskToday(id);
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
    await useTimeBlockStore.getState().refreshBlocks();
    await recordTaskUiAction(id, "skip_task_today");
    return task;
  },

  deferTask: async (id, until) => {
    set({ error: null });
    const task = await taskService.deferTask(id, until);
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
    await useTimeBlockStore.getState().refreshBlocks();
    await recordTaskUiAction(id, "defer_task", { until });
    return task;
  },

  reopenTask: async (id) => {
    set({ error: null });
    const task = await taskService.reopenTask(id);
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
    await useTimeBlockStore.getState().refreshBlocks();
    await recordTaskUiAction(id, "reopen_task");
    return task;
  },

  archiveTask: async (id) => {
    set({ error: null });
    const task = await taskService.archiveTask(id);
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
    await recordTaskUiAction(id, "archive_task");
    return task;
  },

  unarchiveTask: async (id) => {
    set({ error: null });
    const task = await taskService.unarchiveTask(id);
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
    await recordTaskUiAction(id, "unarchive_task");
    return task;
  },

  batchDeleteTasks: async (ids) => {
    set({ error: null });
    const result = await taskService.batchDeleteTasks(ids);
    set((s) => ({ tasks: s.tasks.filter((t) => !result.deletedIds.includes(t.id)) }));
    await useTimeBlockStore.getState().refreshBlocks();
    for (const id of result.deletedIds) {
      await recordTaskUiAction(id, "delete_task", { batch: true });
    }
  },

  runAutoArchive: async (thresholdDays = 7) => {
    set({ error: null });
    const result = await archiveService.runAutoArchive(thresholdDays);
    if (result.archived.length > 0) {
      await get().loadTasks();
      for (const task of result.archived) {
        await recordTaskUiAction(task.id, "auto_archive", { thresholdDays });
      }
    }
  },

  clearError: () => set({ error: null }),
}));
