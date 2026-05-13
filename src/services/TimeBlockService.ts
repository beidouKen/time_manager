import { SqliteTimeBlockRepository } from "@/repositories/sqlite/SqliteTimeBlockRepository";
import type { ITimeBlockRepository } from "@/repositories/interfaces/ITimeBlockRepository";
import type {
  TimeBlock,
  CreateTimeBlockInput,
  UpdateTimeBlockInput,
} from "@/types/timeblock.types";
import { CreateTimeBlockSchema, UpdateTimeBlockSchema } from "@/types/timeblock.types";
import { getDayRange } from "@/lib/dateUtils";

export class TimeBlockService {
  private repo: ITimeBlockRepository;

  constructor(repo?: ITimeBlockRepository) {
    this.repo = repo ?? new SqliteTimeBlockRepository();
  }

  async getBlocksForDate(date: Date): Promise<TimeBlock[]> {
    const { start, end } = getDayRange(date);
    return this.repo.findByDateRange(start, end);
  }

  async getBlocksByTaskId(taskId: string): Promise<TimeBlock[]> {
    return this.repo.findByTaskId(taskId);
  }

  async getBlockById(id: string): Promise<TimeBlock | null> {
    return this.repo.findById(id);
  }

  async createTimeBlock(input: CreateTimeBlockInput): Promise<TimeBlock> {
    const validated = CreateTimeBlockSchema.parse(input);
    return this.repo.create(validated);
  }

  async updateTimeBlock(id: string, input: UpdateTimeBlockInput): Promise<TimeBlock> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("时间块不存在");
    if (existing.deleted_at) throw new Error("时间块已删除");
    if (existing.is_locked) throw new Error("时间块已锁定，不可修改");

    const validated = UpdateTimeBlockSchema.parse(input);
    return this.repo.update(id, validated);
  }

  async updateBlockStatus(
    id: string,
    status: TimeBlock["status"]
  ): Promise<TimeBlock> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("时间块不存在");
    return this.repo.update(id, { status });
  }

  async deleteTimeBlock(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("时间块不存在");
    await this.repo.softDelete(id);
  }

  async countActiveByTaskId(taskId: string): Promise<number> {
    return this.repo.countActiveByTaskId(taskId);
  }
}
