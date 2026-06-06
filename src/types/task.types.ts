import { z } from "zod";

export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus =
  | "todo"
  | "scheduled"
  | "in_progress"
  | "done"
  | "cancelled"
  | "archived"
  | "deferred";

export const TASK_STATUSES: TaskStatus[] = [
  "todo",
  "scheduled",
  "in_progress",
  "done",
  "cancelled",
  "archived",
  "deferred",
];

const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ["scheduled", "cancelled", "done", "deferred"],
  scheduled: ["in_progress", "todo", "cancelled", "done", "deferred"],
  in_progress: ["todo", "cancelled", "done", "deferred", "scheduled"],
  done: ["archived", "todo"],
  cancelled: ["archived", "todo"],
  archived: ["todo", "scheduled"],
  deferred: ["todo", "scheduled", "cancelled", "done"],
};

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  deadline?: string;
  estimated_duration_minutes?: number;
  priority: TaskPriority;
  status: TaskStatus;
  category?: string;
  is_flexible: boolean;
  can_split: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  archived_at?: string;
  completed_at?: string;
  deferred_until?: string;
}

// Zod schemas
export const CreateTaskSchema = z.object({
  title: z.string().min(1, "标题不能为空").max(200, "标题不超过200字"),
  description: z.string().max(2000).optional(),
  deadline: z.string().optional(),
  estimated_duration_minutes: z.number().int().positive().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  category: z.string().max(100).optional(),
  is_flexible: z.boolean().default(true),
  can_split: z.boolean().default(false),
});

// Use z.input to get the "before defaults" type (makes fields with .default() optional)
export type CreateTaskInput = z.input<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    deadline: z.string().optional().nullable(),
    estimated_duration_minutes: z.number().int().positive().optional().nullable(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    // 'archived' is intentionally excluded: must use TaskService.archiveTask() instead
    status: z
      .enum(["todo", "scheduled", "in_progress", "done", "cancelled", "deferred"])
      .optional(),
    category: z.string().max(100).optional().nullable(),
    is_flexible: z.boolean().optional(),
    can_split: z.boolean().optional(),
    archived_at: z.string().optional().nullable(),
    completed_at: z.string().optional().nullable(),
    deferred_until: z.string().optional().nullable(),
  })
  .refine(
    (data) => {
      // archived_at must not be set directly via updateTask; use archiveTask()
      if (data.archived_at !== undefined && data.archived_at !== null) return false;
      return true;
    },
    { message: "archived_at 不可通过 updateTask 直接设置，请使用 archiveTask()" }
  );

export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

/**
 * 内部 Repo/Service 层使用的宽松更新类型。
 * 与 UpdateTaskInput 的区别：status 允许全部 TaskStatus（含 "archived"）。
 * 对外 API（TaskService.updateTask）仍经 UpdateTaskSchema 校验，禁止直接设 archived。
 */
export type TaskPatch = Omit<UpdateTaskInput, "status"> & {
  status?: TaskStatus;
};

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  excludeDeleted?: boolean;
  includeArchived?: boolean;
}
