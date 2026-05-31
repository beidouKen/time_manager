import { SqliteTimeBlockRepository } from "@/repositories/sqlite/SqliteTimeBlockRepository";
import type { ITimeBlockRepository } from "@/repositories/interfaces/ITimeBlockRepository";
import type {
  TimeBlock,
  CreateTimeBlockInput,
  UpdateTimeBlockInput,
} from "@/types/timeblock.types";
import { CreateTimeBlockSchema, UpdateTimeBlockSchema } from "@/types/timeblock.types";
import { getDayRange } from "@/lib/dateUtils";

// V2 执行状态更新的字段子集（用于 HeartbeatService 调用）
// V3.7 P0-2: 加入 feedback_snoozed_until
export type ExecutionStateUpdate = Pick<
  UpdateTimeBlockInput,
  | "status"
  | "reminder_sent_at"
  | "start_prompt_sent_at"
  | "end_prompt_sent_at"
  | "started_at"
  | "completed_at"
  | "skipped_at"
  | "delayed_at"
  | "feedback_note"
  | "feedback_snoozed_until"
>;

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
    if (existing.deleted_at) throw new Error("时间块已删除");
    return this.repo.update(id, { status });
  }

  /**
   * V2：更新执行状态字段（Heartbeat 专用）。
   * 与 updateTimeBlock 的区别：
   * - 不受 is_locked 限制（Heartbeat 状态转换应穿透锁定）
   * - 只接受执行相关字段，不允许修改 title/start_time/end_time 等结构字段
   */
  async updateExecutionState(
    id: string,
    update: ExecutionStateUpdate
  ): Promise<TimeBlock> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("时间块不存在");
    if (existing.deleted_at) throw new Error("时间块已删除");
    return this.repo.update(id, update);
  }

  async deleteTimeBlock(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("时间块不存在");
    await this.repo.softDelete(id);
  }

  async countActiveByTaskId(taskId: string): Promise<number> {
    return this.repo.countActiveByTaskId(taskId);
  }

  /**
   * V3.7 P0-2: 对指定 TimeBlock 设置反馈静默截止时间（snooze）。
   * 静默期内 HeartbeatService.getPendingFeedback 不再返回该 block。
   */
  async snoozeFeedback(blockId: string, untilISO: string): Promise<TimeBlock> {
    return this.updateExecutionState(blockId, { feedback_snoozed_until: untilISO });
  }
}
