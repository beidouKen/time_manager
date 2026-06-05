import type {
  TimeBlock,
  CreateTimeBlockInput,
  UpdateTimeBlockInput,
} from "@/types/timeblock.types";

export interface ITimeBlockRepository {
  findByDateRange(start: Date, end: Date): Promise<TimeBlock[]>;
  findByTaskId(taskId: string): Promise<TimeBlock[]>;
  findById(id: string, options?: { excludeDeleted?: boolean }): Promise<TimeBlock | null>;
  create(data: CreateTimeBlockInput): Promise<TimeBlock>;
  update(id: string, data: UpdateTimeBlockInput): Promise<TimeBlock>;
  softDelete(id: string): Promise<void>;
  countActiveByTaskId(taskId: string): Promise<number>;
}
