// ============================================================
// scheduleTaskTool.rollback.test.ts
//
// 验证 #4 修复：scheduleTaskTool 在"先创建任务、再安排时间块"
// 流程中，时间块安排失败时能补偿删除刚创建的任务（不留孤儿）。
// ============================================================

import { describe, it, expect } from "vitest";
import { ScheduleTaskTool } from "@/agent/tools/schedule/scheduleTaskTool";
import { ScheduleService } from "@/services/ScheduleService";
import type { TimeBlock } from "@/types/timeblock.types";
import {
  MemoryTaskService,
  MemoryTimeBlockService,
} from "@/agent/testing/memoryServices";

// ─── ScheduleService stub：scheduleTaskToTimeBlock 总是抛冲突错误 ──────────────

class ConflictingScheduleService extends ScheduleService {
  override async scheduleTaskToTimeBlock(_input: {
    taskId: string;
    title: string;
    startTime: string;
    endTime: string;
  }): Promise<TimeBlock> {
    throw new Error("时间冲突：与「已有任务」重叠，请调整时间");
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ScheduleTaskTool 补偿回滚 — #4 修复", () => {
  it("安排时间块失败 → 已创建的任务被删除，不留孤儿", async () => {
    const tasks = new MemoryTaskService();
    const blocks = new MemoryTimeBlockService();
    const conflictSchedule = new ConflictingScheduleService();

    const tool = new ScheduleTaskTool(tasks, blocks, conflictSchedule);

    const result = await tool.execute({
      title: "测试任务",
      start_time: "2026-05-30T10:00:00.000Z",
      end_time: "2026-05-30T10:30:00.000Z",
      estimated_duration_minutes: 30,
    });

    // 工具应返回失败消息，包含"已回滚"
    expect(result.success).toBe(false);
    expect(result.message).toContain("已回滚");

    // 核心：内存中不应有残留的活跃任务（孤儿）
    const activeTasks = tasks.tasks.filter((t) => !t.deleted_at);
    expect(activeTasks).toHaveLength(0);
  });

  it("安排时间块成功 → 任务和时间块均创建", async () => {
    const tasks = new MemoryTaskService();
    const blocks = new MemoryTimeBlockService();

    // 使用能成功的 MemoryScheduleService
    const { MemoryScheduleService } = await import("@/agent/testing/memoryServices");
    const schedule = new MemoryScheduleService(tasks, blocks);

    const tool = new ScheduleTaskTool(tasks, blocks, schedule);

    const result = await tool.execute({
      title: "成功任务",
      start_time: "2026-05-30T14:00:00.000Z",
      end_time: "2026-05-30T14:30:00.000Z",
      estimated_duration_minutes: 30,
    });

    expect(result.success).toBe(true);
    expect(tasks.tasks.filter((t) => !t.deleted_at)).toHaveLength(1);
    expect(blocks.blocks.filter((b) => !b.deleted_at)).toHaveLength(1);
  });
});
