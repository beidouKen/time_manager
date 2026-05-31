// ============================================================
// HeartbeatService.feedbackSnooze.test.ts — V3.7 P0-2
//
// 覆盖 Heartbeat 反馈重复弹窗修复：
// 1. 已结束 block + 未 snooze → getPendingFeedback 返回它
// 2. snoozeFeedback(+10min) 后 5 分钟内 getPendingFeedback 返回 null
// 3. 11 分钟后 getPendingFeedback 重新返回该 block
// 4. extended（end_time > now）后 getPendingFeedback 返回 null
// 5. end_prompt_sent_at 仍是 hard stop（与 snooze 区分）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HeartbeatService } from "@/services/HeartbeatService";
import { TimeBlockService } from "@/services/TimeBlockService";
import { TaskService } from "@/services/TaskService";
import type { ITimeBlockRepository } from "@/repositories/interfaces/ITimeBlockRepository";
import type {
  TimeBlock,
  CreateTimeBlockInput,
  UpdateTimeBlockInput,
} from "@/types/timeblock.types";

class MemoryTimeBlockRepository implements ITimeBlockRepository {
  blocks: TimeBlock[] = [];
  private seq = 1;

  async findByDateRange(_start: Date, _end: Date): Promise<TimeBlock[]> {
    return this.blocks.filter((b) => !b.deleted_at);
  }

  async findByTaskId(taskId: string): Promise<TimeBlock[]> {
    return this.blocks.filter((b) => b.task_id === taskId && !b.deleted_at);
  }

  async findById(id: string): Promise<TimeBlock | null> {
    return this.blocks.find((b) => b.id === id) ?? null;
  }

  async create(data: CreateTimeBlockInput): Promise<TimeBlock> {
    const now = new Date().toISOString();
    const block: TimeBlock = {
      id: `block-${this.seq++}`,
      task_id: data.task_id,
      title: data.title,
      start_time: data.start_time,
      end_time: data.end_time,
      type: data.type ?? "task",
      status: "scheduled",
      is_locked: data.is_locked ?? false,
      source: data.source ?? "system",
      created_at: now,
      updated_at: now,
    };
    this.blocks.push(block);
    return block;
  }

  async update(id: string, data: UpdateTimeBlockInput): Promise<TimeBlock> {
    const idx = this.blocks.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error("not found");
    const existing = this.blocks[idx];
    // task_id 在 schema 里是 nullable，转回 undefined 以满足 TimeBlock 类型
    const taskIdPatched =
      data.task_id === null ? undefined : data.task_id ?? existing.task_id;
    const next: TimeBlock = {
      ...existing,
      ...data,
      task_id: taskIdPatched,
      // null 表示清空字段
      reminder_sent_at:
        data.reminder_sent_at === null
          ? undefined
          : data.reminder_sent_at ?? existing.reminder_sent_at,
      start_prompt_sent_at:
        data.start_prompt_sent_at === null
          ? undefined
          : data.start_prompt_sent_at ?? existing.start_prompt_sent_at,
      end_prompt_sent_at:
        data.end_prompt_sent_at === null
          ? undefined
          : data.end_prompt_sent_at ?? existing.end_prompt_sent_at,
      started_at:
        data.started_at === null ? undefined : data.started_at ?? existing.started_at,
      completed_at:
        data.completed_at === null
          ? undefined
          : data.completed_at ?? existing.completed_at,
      skipped_at:
        data.skipped_at === null ? undefined : data.skipped_at ?? existing.skipped_at,
      delayed_at:
        data.delayed_at === null ? undefined : data.delayed_at ?? existing.delayed_at,
      feedback_note:
        data.feedback_note === null
          ? undefined
          : data.feedback_note ?? existing.feedback_note,
      feedback_snoozed_until:
        data.feedback_snoozed_until === null
          ? undefined
          : data.feedback_snoozed_until ?? existing.feedback_snoozed_until,
      updated_at: new Date().toISOString(),
    };
    this.blocks[idx] = next;
    return next;
  }

  async softDelete(id: string): Promise<void> {
    const b = this.blocks.find((x) => x.id === id);
    if (b) b.deleted_at = new Date().toISOString();
  }

  async countActiveByTaskId(taskId: string): Promise<number> {
    return this.blocks.filter((b) => b.task_id === taskId && !b.deleted_at).length;
  }
}

function makeEndedBlock(
  repo: MemoryTimeBlockRepository,
  endMinutesAgo: number,
  durationMinutes = 30
): TimeBlock {
  const now = Date.now();
  const block: TimeBlock = {
    id: `block-${Date.now()}-${Math.random()}`,
    title: "测试任务",
    start_time: new Date(
      now - (endMinutesAgo + durationMinutes) * 60 * 1000
    ).toISOString(),
    end_time: new Date(now - endMinutesAgo * 60 * 1000).toISOString(),
    type: "task",
    status: "scheduled",
    is_locked: false,
    source: "system",
    created_at: new Date(now - 60 * 60 * 1000).toISOString(),
    updated_at: new Date(now - 60 * 60 * 1000).toISOString(),
  };
  repo.blocks.push(block);
  return block;
}

describe("HeartbeatService — feedback snooze (P0-2)", () => {
  let repo: MemoryTimeBlockRepository;
  let timeBlockService: TimeBlockService;
  let heartbeat: HeartbeatService;

  const NOW_BASELINE = new Date("2026-05-30T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_BASELINE);
    repo = new MemoryTimeBlockRepository();
    timeBlockService = new TimeBlockService(repo);
    // TaskService 在本测试不会被调用（snooze 不联动 Task），传一个 stub。
    heartbeat = new HeartbeatService(timeBlockService, new TaskService());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hb-1: 已结束 block 未 snooze → getPendingFeedback 返回它", () => {
    const block = makeEndedBlock(repo, 5);
    const result = heartbeat.getPendingFeedback(repo.blocks, new Date());
    expect(result?.id).toBe(block.id);
  });

  it("hb-2: snoozeFeedback +10min 后立刻查询 → 返回 null", async () => {
    const block = makeEndedBlock(repo, 5);
    await heartbeat.snoozeFeedback(block.id, { minutes: 10 });

    const persisted = await timeBlockService.getBlockById(block.id);
    expect(persisted?.feedback_snoozed_until).toBeTruthy();
    // 暂缓截止时间应大于当前时间
    expect(new Date(persisted!.feedback_snoozed_until!).getTime()).toBeGreaterThan(
      NOW_BASELINE.getTime()
    );

    const result = heartbeat.getPendingFeedback(repo.blocks, new Date());
    expect(result).toBeNull();
  });

  it("hb-3: snooze +10min，5 分钟后仍在静默期 → 返回 null", async () => {
    const block = makeEndedBlock(repo, 5);
    await heartbeat.snoozeFeedback(block.id, { minutes: 10 });

    vi.advanceTimersByTime(5 * 60 * 1000);
    const result = heartbeat.getPendingFeedback(repo.blocks, new Date());
    expect(result).toBeNull();
  });

  it("hb-4: snooze +10min，11 分钟后过期 → 重新返回该 block", async () => {
    const block = makeEndedBlock(repo, 5);
    await heartbeat.snoozeFeedback(block.id, { minutes: 10 });

    vi.advanceTimersByTime(11 * 60 * 1000);
    const result = heartbeat.getPendingFeedback(repo.blocks, new Date());
    expect(result?.id).toBe(block.id);
  });

  it("hb-5: extended（end_time > now）后 → getPendingFeedback 返回 null", () => {
    const block = makeEndedBlock(repo, 5);
    // 模拟「延长当前任务」：把 end_time 改为未来 30 分钟。
    block.end_time = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const result = heartbeat.getPendingFeedback(repo.blocks, new Date());
    expect(result).toBeNull();
  });

  it("hb-6: end_prompt_sent_at 仍是永久 hard stop（与 snooze 语义区分）", () => {
    const block = makeEndedBlock(repo, 5);
    block.end_prompt_sent_at = new Date(Date.now() - 60 * 1000).toISOString();

    const result = heartbeat.getPendingFeedback(repo.blocks, new Date());
    expect(result).toBeNull();
  });

  it("hb-7: 多个 block，snooze 仅影响被 snooze 的那个", async () => {
    const blockA = makeEndedBlock(repo, 10); // 较早结束
    makeEndedBlock(repo, 5); // 较晚结束
    await heartbeat.snoozeFeedback(blockA.id, { minutes: 10 });

    const result = heartbeat.getPendingFeedback(repo.blocks, new Date());
    // blockA 已 snooze，应返回剩下那个未 snooze 的（它 end_time 也较早，但 A 被排除）
    expect(result).not.toBeNull();
    expect(result?.id).not.toBe(blockA.id);
  });
});
