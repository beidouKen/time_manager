// ============================================================
// MockMemoryAdapter.ts — 进程内 MemoryAdapter 实现
//
// 用于测试和 V5 mock 验证路径。不写磁盘、不接 DB。
// dump() 方法供测试断言使用。
// ============================================================

import type {
  BehaviorRecord,
  MemoryAdapter,
  RecentBehaviorSummary,
} from "@/agent/memory/MemoryAdapter";

export class MockMemoryAdapter implements MemoryAdapter {
  private records: BehaviorRecord[] = [];

  async recordSchedule(
    record: Omit<BehaviorRecord, "type" | "timestamp">
  ): Promise<void> {
    this.records.push({
      ...record,
      type: "task_scheduled",
      timestamp: new Date().toISOString(),
    });
  }

  async recordTaskCompletion(
    record: Omit<BehaviorRecord, "type" | "timestamp"> & { actualMinutes?: number }
  ): Promise<void> {
    this.records.push({
      ...record,
      type: "task_completed",
      timestamp: new Date().toISOString(),
    });
  }

  async getRecentBehavior(windowDays: number): Promise<RecentBehaviorSummary> {
    const cutoff = new Date(
      Date.now() - windowDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const recent = this.records.filter((r) => r.timestamp >= cutoff);

    const completionByCategory: Record<string, { completed: number; total: number }> = {};
    for (const r of recent) {
      const cat = r.category ?? "__default__";
      if (!completionByCategory[cat]) {
        completionByCategory[cat] = { completed: 0, total: 0 };
      }
      completionByCategory[cat].total++;
      if (r.type === "task_completed") completionByCategory[cat].completed++;
    }

    const completionRateByCategory: Record<string, number> = {};
    for (const [cat, { completed, total }] of Object.entries(completionByCategory)) {
      completionRateByCategory[cat] = total > 0 ? completed / total : 0;
    }

    const scheduledDays = new Set(
      recent.filter((r) => r.type === "task_scheduled").map((r) => r.timestamp.slice(0, 10))
    );
    const avgBlocksPerDay = scheduledDays.size > 0
      ? recent.filter((r) => r.type === "task_scheduled").length / scheduledDays.size
      : 0;

    return {
      records: recent,
      completionRateByCategory,
      avgBlocksPerDay,
    };
  }

  /** 导出所有原始记录（供测试断言） */
  dump(): BehaviorRecord[] {
    return [...this.records];
  }

  /** 清空所有记录（供测试 beforeEach 重置） */
  clear(): void {
    this.records = [];
  }
}
