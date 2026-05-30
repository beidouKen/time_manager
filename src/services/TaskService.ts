import { SqliteTaskRepository } from "@/repositories/sqlite/SqliteTaskRepository";
import type { ITaskRepository } from "@/repositories/interfaces/ITaskRepository";
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskStatus,
} from "@/types/task.types";
import { CreateTaskSchema, UpdateTaskSchema } from "@/types/task.types";

export class TaskService {
  private repo: ITaskRepository;

  constructor(repo?: ITaskRepository) {
    this.repo = repo ?? new SqliteTaskRepository();
  }

  async getTasks(filter?: TaskFilter): Promise<Task[]> {
    return this.repo.findAll(filter);
  }

  async getTaskById(id: string): Promise<Task | null> {
    return this.repo.findById(id);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const validated = CreateTaskSchema.parse(input);
    return this.repo.create(validated);
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("任务不存在");
    if (existing.deleted_at) throw new Error("任务已删除");

    const validated = UpdateTaskSchema.parse(input);
    return this.repo.update(id, validated);
  }

  async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("任务不存在");
    return this.repo.update(id, { status });
  }

  async deleteTask(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("任务不存在");
    await this.repo.softDelete(id);
  }

  async getActiveTasks(): Promise<Task[]> {
    return this.repo.findAll({
      status: ["todo", "scheduled", "in_progress"],
      excludeDeleted: true,
    });
  }
}
