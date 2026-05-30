import { z } from "zod";

export type TimeBlockType = "task" | "event" | "break" | "routine";
export type TimeBlockStatus =
  | "scheduled"
  | "in_progress"
  | "done"
  | "skipped"
  | "cancelled"
  | "delayed";
export type TimeBlockSource = "manual" | "system";

export interface TimeBlock {
  id: string;
  task_id?: string;
  title: string;
  start_time: string;
  end_time: string;
  type: TimeBlockType;
  status: TimeBlockStatus;
  is_locked: boolean;
  source: TimeBlockSource;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  // V2 执行时间戳字段
  reminder_sent_at?: string;
  start_prompt_sent_at?: string;
  end_prompt_sent_at?: string;
  started_at?: string;
  completed_at?: string;
  skipped_at?: string;
  delayed_at?: string;
  feedback_note?: string;
}

export const CreateTimeBlockSchema = z
  .object({
    task_id: z.string().optional(),
    title: z.string().min(1, "标题不能为空").max(200),
    start_time: z.string().min(1, "请选择开始时间"),
    end_time: z.string().min(1, "请选择结束时间"),
    type: z.enum(["task", "event", "break", "routine"]).default("task"),
    is_locked: z.boolean().default(false),
    source: z.enum(["manual", "system"]).default("manual"),
  })
  .refine((data) => data.end_time > data.start_time, {
    message: "结束时间必须晚于开始时间",
    path: ["end_time"],
  });

// Use z.input to get the "before defaults" type (makes fields with .default() optional)
export type CreateTimeBlockInput = z.input<typeof CreateTimeBlockSchema>;

export const UpdateTimeBlockSchema = z.object({
  task_id: z.string().optional().nullable(),
  title: z.string().min(1).max(200).optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  type: z.enum(["task", "event", "break", "routine"]).optional(),
  status: z
    .enum(["scheduled", "in_progress", "done", "skipped", "cancelled", "delayed"])
    .optional(),
  is_locked: z.boolean().optional(),
  // V2 执行时间戳字段（均为可选，由 HeartbeatService 按需更新）
  reminder_sent_at: z.string().nullable().optional(),
  start_prompt_sent_at: z.string().nullable().optional(),
  end_prompt_sent_at: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  skipped_at: z.string().nullable().optional(),
  delayed_at: z.string().nullable().optional(),
  feedback_note: z.string().nullable().optional(),
});

export type UpdateTimeBlockInput = z.infer<typeof UpdateTimeBlockSchema>;
