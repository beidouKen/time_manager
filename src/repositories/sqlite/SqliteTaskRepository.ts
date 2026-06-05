import { getDb } from "@/db/client";
import type { ITaskRepository } from "@/repositories/interfaces/ITaskRepository";
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskStatus,
} from "@/types/task.types";

// SQLite returns integers as numbers, but booleans as 0/1
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? undefined,
    deadline: (row.deadline as string) ?? undefined,
    estimated_duration_minutes:
      (row.estimated_duration_minutes as number) ?? undefined,
    priority: row.priority as Task["priority"],
    status: row.status as Task["status"],
    category: (row.category as string) ?? undefined,
    is_flexible: Boolean(row.is_flexible),
    can_split: Boolean(row.can_split),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: (row.deleted_at as string) ?? undefined,
    archived_at: (row.archived_at as string) ?? undefined,
    completed_at: (row.completed_at as string) ?? undefined,
    deferred_until: (row.deferred_until as string) ?? undefined,
  };
}

export class SqliteTaskRepository implements ITaskRepository {
  async findAll(filter?: TaskFilter): Promise<Task[]> {
    const db = await getDb();
    const excludeDeleted = filter?.excludeDeleted !== false;

    let sql = "SELECT * FROM tasks WHERE 1=1";
    const params: unknown[] = [];

    if (excludeDeleted) {
      sql += " AND deleted_at IS NULL";
    }

    if (!filter?.includeArchived) {
      sql += " AND archived_at IS NULL";
    }

    if (filter?.status) {
      const statuses = Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
      const placeholders = statuses
        .map((_, i) => `$${params.length + i + 1}`)
        .join(", ");
      sql += ` AND status IN (${placeholders})`;
      params.push(...statuses);
    }

    sql += " ORDER BY created_at DESC";

    const rows = await db.select<Record<string, unknown>[]>(sql, params);
    return rows.map(rowToTask);
  }

  async findById(
    id: string,
    options: { excludeDeleted?: boolean } = {}
  ): Promise<Task | null> {
    const db = await getDb();
    const excludeDeleted = options.excludeDeleted === true;
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM tasks WHERE id = $1${excludeDeleted ? " AND deleted_at IS NULL" : ""}`,
      [id]
    );
    if (rows.length === 0) return null;
    return rowToTask(rows[0]);
  }

  async create(data: CreateTaskInput): Promise<Task> {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO tasks (
        id, title, description, deadline, estimated_duration_minutes,
        priority, status, category, is_flexible, can_split, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'todo', $7, $8, $9, $10, $11)`,
      [
        id,
        data.title,
        data.description ?? null,
        data.deadline ?? null,
        data.estimated_duration_minutes ?? null,
        data.priority ?? "medium",
        data.category ?? null,
        data.is_flexible !== undefined ? (data.is_flexible ? 1 : 0) : 1,
        data.can_split !== undefined ? (data.can_split ? 1 : 0) : 0,
        now,
        now,
      ]
    );

    const task = await this.findById(id);
    if (!task) throw new Error("创建任务失败");
    return task;
  }

  async update(id: string, data: UpdateTaskInput): Promise<Task> {
    const db = await getDb();
    const now = new Date().toISOString();

    const fields: string[] = ["updated_at = $1"];
    const params: unknown[] = [now];
    let idx = 2;

    if (data.title !== undefined) {
      fields.push(`title = $${idx++}`);
      params.push(data.title);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${idx++}`);
      params.push(data.description ?? null);
    }
    if (data.deadline !== undefined) {
      fields.push(`deadline = $${idx++}`);
      params.push(data.deadline ?? null);
    }
    if (data.estimated_duration_minutes !== undefined) {
      fields.push(`estimated_duration_minutes = $${idx++}`);
      params.push(data.estimated_duration_minutes ?? null);
    }
    if (data.priority !== undefined) {
      fields.push(`priority = $${idx++}`);
      params.push(data.priority);
    }
    if (data.status !== undefined) {
      fields.push(`status = $${idx++}`);
      params.push(data.status);
    }
    if (data.category !== undefined) {
      fields.push(`category = $${idx++}`);
      params.push(data.category ?? null);
    }
    if (data.is_flexible !== undefined) {
      fields.push(`is_flexible = $${idx++}`);
      params.push(data.is_flexible ? 1 : 0);
    }
    if (data.can_split !== undefined) {
      fields.push(`can_split = $${idx++}`);
      params.push(data.can_split ? 1 : 0);
    }
    if (data.archived_at !== undefined) {
      fields.push(`archived_at = $${idx++}`);
      params.push(data.archived_at ?? null);
    }
    if (data.completed_at !== undefined) {
      fields.push(`completed_at = $${idx++}`);
      params.push(data.completed_at ?? null);
    }
    if (data.deferred_until !== undefined) {
      fields.push(`deferred_until = $${idx++}`);
      params.push(data.deferred_until ?? null);
    }

    params.push(id);
    await db.execute(
      `UPDATE tasks SET ${fields.join(", ")} WHERE id = $${idx}`,
      params
    );

    const task = await this.findById(id);
    if (!task) throw new Error("任务不存在");
    return task;
  }

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    const db = await getDb();
    await db.execute(
      "UPDATE tasks SET status = $1, updated_at = $2 WHERE id = $3",
      [status, new Date().toISOString(), id]
    );
  }

  async softDelete(id: string): Promise<void> {
    const db = await getDb();
    await db.execute(
      "UPDATE tasks SET deleted_at = $1, updated_at = $2 WHERE id = $3",
      [new Date().toISOString(), new Date().toISOString(), id]
    );
  }
}
