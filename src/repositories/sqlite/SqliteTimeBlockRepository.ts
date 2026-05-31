import { getDb } from "@/db/client";
import type { ITimeBlockRepository } from "@/repositories/interfaces/ITimeBlockRepository";
import type {
  TimeBlock,
  CreateTimeBlockInput,
  UpdateTimeBlockInput,
} from "@/types/timeblock.types";

function rowToTimeBlock(row: Record<string, unknown>): TimeBlock {
  return {
    id: row.id as string,
    task_id: (row.task_id as string) ?? undefined,
    title: row.title as string,
    start_time: row.start_time as string,
    end_time: row.end_time as string,
    type: row.type as TimeBlock["type"],
    status: row.status as TimeBlock["status"],
    is_locked: Boolean(row.is_locked),
    source: row.source as TimeBlock["source"],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: (row.deleted_at as string) ?? undefined,
    // V2 执行时间戳字段
    reminder_sent_at: (row.reminder_sent_at as string) ?? undefined,
    start_prompt_sent_at: (row.start_prompt_sent_at as string) ?? undefined,
    end_prompt_sent_at: (row.end_prompt_sent_at as string) ?? undefined,
    started_at: (row.started_at as string) ?? undefined,
    completed_at: (row.completed_at as string) ?? undefined,
    skipped_at: (row.skipped_at as string) ?? undefined,
    delayed_at: (row.delayed_at as string) ?? undefined,
    feedback_note: (row.feedback_note as string) ?? undefined,
    feedback_snoozed_until:
      (row.feedback_snoozed_until as string) ?? undefined,
  };
}

export class SqliteTimeBlockRepository implements ITimeBlockRepository {
  async findByDateRange(start: Date, end: Date): Promise<TimeBlock[]> {
    const db = await getDb();
    const startStr = start.toISOString();
    const endStr = end.toISOString();

    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM time_blocks
       WHERE deleted_at IS NULL
         AND start_time < $1
         AND end_time > $2
       ORDER BY start_time ASC`,
      [endStr, startStr]
    );
    return rows.map(rowToTimeBlock);
  }

  async findByTaskId(taskId: string): Promise<TimeBlock[]> {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM time_blocks WHERE task_id = $1 AND deleted_at IS NULL ORDER BY start_time ASC",
      [taskId]
    );
    return rows.map(rowToTimeBlock);
  }

  async findById(id: string): Promise<TimeBlock | null> {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM time_blocks WHERE id = $1",
      [id]
    );
    if (rows.length === 0) return null;
    return rowToTimeBlock(rows[0]);
  }

  async create(data: CreateTimeBlockInput): Promise<TimeBlock> {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO time_blocks (
        id, task_id, title, start_time, end_time,
        type, status, is_locked, source, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7, $8, $9, $10)`,
      [
        id,
        data.task_id ?? null,
        data.title,
        data.start_time,
        data.end_time,
        data.type ?? "task",
        data.is_locked !== undefined ? (data.is_locked ? 1 : 0) : 0,
        data.source ?? "manual",
        now,
        now,
      ]
    );

    const block = await this.findById(id);
    if (!block) throw new Error("创建时间块失败");
    return block;
  }

  async update(id: string, data: UpdateTimeBlockInput): Promise<TimeBlock> {
    const db = await getDb();
    const now = new Date().toISOString();

    const fields: string[] = ["updated_at = $1"];
    const params: unknown[] = [now];
    let idx = 2;

    if (data.task_id !== undefined) {
      fields.push(`task_id = $${idx++}`);
      params.push(data.task_id ?? null);
    }
    if (data.title !== undefined) {
      fields.push(`title = $${idx++}`);
      params.push(data.title);
    }
    if (data.start_time !== undefined) {
      fields.push(`start_time = $${idx++}`);
      params.push(data.start_time);
    }
    if (data.end_time !== undefined) {
      fields.push(`end_time = $${idx++}`);
      params.push(data.end_time);
    }
    if (data.type !== undefined) {
      fields.push(`type = $${idx++}`);
      params.push(data.type);
    }
    if (data.status !== undefined) {
      fields.push(`status = $${idx++}`);
      params.push(data.status);
    }
    if (data.is_locked !== undefined) {
      fields.push(`is_locked = $${idx++}`);
      params.push(data.is_locked ? 1 : 0);
    }
    // V2 执行时间戳字段
    if (data.reminder_sent_at !== undefined) {
      fields.push(`reminder_sent_at = $${idx++}`);
      params.push(data.reminder_sent_at ?? null);
    }
    if (data.start_prompt_sent_at !== undefined) {
      fields.push(`start_prompt_sent_at = $${idx++}`);
      params.push(data.start_prompt_sent_at ?? null);
    }
    if (data.end_prompt_sent_at !== undefined) {
      fields.push(`end_prompt_sent_at = $${idx++}`);
      params.push(data.end_prompt_sent_at ?? null);
    }
    if (data.started_at !== undefined) {
      fields.push(`started_at = $${idx++}`);
      params.push(data.started_at ?? null);
    }
    if (data.completed_at !== undefined) {
      fields.push(`completed_at = $${idx++}`);
      params.push(data.completed_at ?? null);
    }
    if (data.skipped_at !== undefined) {
      fields.push(`skipped_at = $${idx++}`);
      params.push(data.skipped_at ?? null);
    }
    if (data.delayed_at !== undefined) {
      fields.push(`delayed_at = $${idx++}`);
      params.push(data.delayed_at ?? null);
    }
    if (data.feedback_note !== undefined) {
      fields.push(`feedback_note = $${idx++}`);
      params.push(data.feedback_note ?? null);
    }
    if (data.feedback_snoozed_until !== undefined) {
      fields.push(`feedback_snoozed_until = $${idx++}`);
      params.push(data.feedback_snoozed_until ?? null);
    }
    if (data.deleted_at !== undefined) {
      fields.push(`deleted_at = $${idx++}`);
      params.push(data.deleted_at ?? null);
    }

    params.push(id);
    await db.execute(
      `UPDATE time_blocks SET ${fields.join(", ")} WHERE id = $${idx}`,
      params
    );

    const block = await this.findById(id);
    if (!block) throw new Error("时间块不存在");
    return block;
  }

  async softDelete(id: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.execute(
      "UPDATE time_blocks SET deleted_at = $1, updated_at = $2 WHERE id = $3",
      [now, now, id]
    );
  }

  async countActiveByTaskId(taskId: string): Promise<number> {
    const db = await getDb();
    const rows = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM time_blocks
       WHERE task_id = $1
         AND deleted_at IS NULL
         AND status NOT IN ('done', 'skipped', 'cancelled', 'delayed')`,
      [taskId]
    );
    return rows[0]?.count ?? 0;
  }
}
