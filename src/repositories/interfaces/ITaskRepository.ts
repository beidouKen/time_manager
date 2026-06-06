import type {
  Task,
  CreateTaskInput,
  TaskFilter,
  TaskPatch,
} from "@/types/task.types";

export interface ITaskRepository {
  findAll(filter?: TaskFilter): Promise<Task[]>;
  findById(id: string, options?: { excludeDeleted?: boolean }): Promise<Task | null>;
  create(data: CreateTaskInput): Promise<Task>;
  update(id: string, data: TaskPatch): Promise<Task>;
  softDelete(id: string): Promise<void>;
}
