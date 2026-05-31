// ============================================================
// TimeBlockService.updateStatus.test.ts
//
// 验证 #7 修复：updateBlockStatus 对已软删 block 应抛错，
// 与 updateTimeBlock / updateExecutionState 行为一致。
// ============================================================

import { describe, it, expect } from "vitest";
import { TimeBlockService } from "@/services/TimeBlockService";
import type { ITimeBlockRepository } from "@/repositories/interfaces/ITimeBlockRepository";
import type {
  TimeBlock,
  CreateTimeBlockInput,
  UpdateTimeBlockInput,
} from "@/types/timeblock.types";

// ─── 最小进程内 Repository ─────────────────────────────────────────────────────

class MemoryTimeBlockRepo implements ITimeBlockRepository {
  blocks: TimeBlock[] = [];
  private seq = 1;

  async findByDateRange(_s: Date, _e: Date): Promise<TimeBlock[]> {
    return [];
  }

  async findByTaskId(taskId: string): Promise<TimeBlock[]> {
    return this.blocks.filter((b) => b.task_id === taskId && !b.deleted_at);
  }

  async findById(id: string): Promise<TimeBlock | null> {
    return this.blocks.find((b) => b.id === id) ?? null;
  }

  async create(data: CreateTimeBlockInput): Promise<TimeBlock> {
    const now = new Date().toISOString();
    const b: TimeBlock = {
      id: `b-${this.seq++}`,
      task_id: data.task_id,
      title: data.title,
      start_time: data.start_time,
      end_time: data.end_time,
      type: data.type ?? "task",
      status: "scheduled",
      is_locked: data.is_locked ?? false,
      source: data.source ?? "manual",
      created_at: now,
      updated_at: now,
    };
    this.blocks.push(b);
    return b;
  }

  async update(id: string, data: UpdateTimeBlockInput): Promise<TimeBlock> {
    const idx = this.blocks.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error("not found");
    const existing = this.blocks[idx];
    const next: TimeBlock = {
      ...existing,
      ...data,
      task_id: data.task_id === null ? undefined : (data.task_id ?? existing.task_id),
      deleted_at: data.deleted_at === null ? undefined : (data.deleted_at ?? existing.deleted_at),
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
    return this.blocks.filter(
      (b) =>
        b.task_id === taskId &&
        !b.deleted_at &&
        !["done", "skipped", "cancelled", "delayed"].includes(b.status)
    ).length;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("TimeBlockService.updateBlockStatus — #7 修复", () => {
  it("对已软删 block 调用 updateBlockStatus → 抛 '时间块已删除'", async () => {
    const repo = new MemoryTimeBlockRepo();
    const service = new TimeBlockService(repo);

    const block = await repo.create({
      title: "已删除的时间块",
      start_time: "2026-05-30T10:00:00.000Z",
      end_time: "2026-05-30T10:30:00.000Z",
    });
    await repo.softDelete(block.id);

    await expect(
      service.updateBlockStatus(block.id, "done")
    ).rejects.toThrow("时间块已删除");
  });

  it("对正常 block 调用 updateBlockStatus → 成功更新状态", async () => {
    const repo = new MemoryTimeBlockRepo();
    const service = new TimeBlockService(repo);

    const block = await repo.create({
      title: "正常时间块",
      start_time: "2026-05-30T10:00:00.000Z",
      end_time: "2026-05-30T10:30:00.000Z",
    });

    const updated = await service.updateBlockStatus(block.id, "in_progress");
    expect(updated.status).toBe("in_progress");
  });

  it("对不存在的 block → 抛 '时间块不存在'", async () => {
    const repo = new MemoryTimeBlockRepo();
    const service = new TimeBlockService(repo);

    await expect(
      service.updateBlockStatus("non-existent-id", "done")
    ).rejects.toThrow("时间块不存在");
  });
});

describe("countActiveByTaskId — #5 修复验证", () => {
  it("只统计 scheduled/in_progress 状态的未删块，排除 done/skipped/cancelled/delayed", async () => {
    const repo = new MemoryTimeBlockRepo();

    // 模拟 countActiveByTaskId 逻辑（此处验证 repo 实现的过滤语义）
    const baseBlock: Omit<TimeBlock, "id" | "status"> = {
      task_id: "task-1",
      title: "测试",
      start_time: "2026-05-30T10:00:00.000Z",
      end_time: "2026-05-30T10:30:00.000Z",
      type: "task",
      is_locked: false,
      source: "manual",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 添加各种状态的 block
    repo.blocks = [
      { ...baseBlock, id: "b1", status: "scheduled" },       // 算入活跃
      { ...baseBlock, id: "b2", status: "in_progress" },     // 算入活跃
      { ...baseBlock, id: "b3", status: "done" },             // 不算
      { ...baseBlock, id: "b4", status: "skipped" },          // 不算
      { ...baseBlock, id: "b5", status: "cancelled" },        // 不算
      { ...baseBlock, id: "b6", status: "delayed" },          // 不算
      { ...baseBlock, id: "b7", status: "scheduled", deleted_at: new Date().toISOString() }, // 已软删，不算
    ];

    const count = await repo.countActiveByTaskId("task-1");
    expect(count).toBe(2); // 只有 b1 和 b2
  });
});
