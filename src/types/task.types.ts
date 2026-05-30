import { z } from "zod";

export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus =
  | "todo"
  | "scheduled"
  | "in_progress"
  | "done"
  | "cancelled";

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

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  deadline: z.string().optional().nullable(),
  estimated_duration_minutes: z.number().int().positive().optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  status: z
    .enum(["todo", "scheduled", "in_progress", "done", "cancelled"])
    .optional(),
  category: z.string().max(100).optional().nullable(),
  is_flexible: z.boolean().optional(),
  can_split: z.boolean().optional(),
});

export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  excludeDeleted?: boolean;
}
