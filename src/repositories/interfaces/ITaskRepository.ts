import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
} from "@/types/task.types";

export interface ITaskRepository {
  findAll(filter?: TaskFilter): Promise<Task[]>;
  findById(id: string, options?: { excludeDeleted?: boolean }): Promise<Task | null>;
  create(data: CreateTaskInput): Promise<Task>;
  update(id: string, data: UpdateTaskInput): Promise<Task>;
  softDelete(id: string): Promise<void>;
}
