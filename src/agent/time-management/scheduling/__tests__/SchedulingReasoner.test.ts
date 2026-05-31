// ============================================================
// SchedulingReasoner.test.ts — V3.7 P0-3
//
// 覆盖 "未指定时间时不得推荐过去时间" 修复：
// 1. 不传 now → 旧行为（取 slot.start）
// 2. 传 now（位于 slot 中段） → effectiveStart = now + buffer
// 3. 传 now（在 slot 之后） → 该 slot 应被排除
// 4. duration 大于 slot 剩余 → 该 slot 被排除
// 5. 多个 slot 时，buffer 仅影响落在它前面的那个
// ============================================================

import { describe, it, expect } from "vitest";
import {
  SchedulingReasoner,
  type SchedulingRankOptions,
} from "@/agent/time-management/scheduling/SchedulingReasoner";

const reasoner = new SchedulingReasoner();

function iso(localUtcDateMs: number): string {
  return new Date(localUtcDateMs).toISOString();
}

// 上海时区 2026-05-30 08:00 = UTC 00:00
const DAY_UTC_BASE = Date.UTC(2026, 4, 30, 0, 0, 0); // 08:00 上海
const DAY_UTC_END = Date.UTC(2026, 4, 30, 14, 0, 0); // 22:00 上海

const FULL_DAY_SLOT = { start: iso(DAY_UTC_BASE), end: iso(DAY_UTC_END) };

describe("SchedulingReasoner — now+buffer (P0-3)", () => {
  it("sr-1: 不传 now → 旧行为，从 slot.start 起", () => {
    const result = reasoner.rank([FULL_DAY_SLOT], 30);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(FULL_DAY_SLOT.start);
  });

  it("sr-2: 当前时间是上海 14:00（slot 中段） → effectiveStart >= now + 15min", () => {
    // 上海 14:00 = UTC 06:00
    const now = new Date(Date.UTC(2026, 4, 30, 6, 0, 0));
    const options: SchedulingRankOptions = { now, bufferMinutes: 15 };
    const result = reasoner.rank([FULL_DAY_SLOT], 30, options);
    expect(result).toHaveLength(1);

    const startMs = new Date(result[0].start).getTime();
    const nowPlusBuffer = now.getTime() + 15 * 60 * 1000;
    expect(startMs).toBeGreaterThanOrEqual(nowPlusBuffer);
    // 不应等于 slot.start（08:00），即旧行为已被纠正
    expect(result[0].start).not.toBe(FULL_DAY_SLOT.start);
    // 应正好等于 now + buffer（slot 还很长，无需进一步推后）
    expect(startMs).toBe(nowPlusBuffer);
  });

  it("sr-3: now 在 slot 之后（22:30） → 该 slot 被排除（无候选）", () => {
    // 上海 22:30 = UTC 14:30，slot 已结束
    const now = new Date(Date.UTC(2026, 4, 30, 14, 30, 0));
    const result = reasoner.rank([FULL_DAY_SLOT], 30, { now });
    expect(result).toHaveLength(0);
  });

  it("sr-4: now+buffer 后剩余时长不够 30min → 该 slot 被排除", () => {
    // slot 长 8 小时；如果 now=21:50 上海 = UTC 13:50，剩 10min < 30min
    const now = new Date(Date.UTC(2026, 4, 30, 13, 50, 0));
    const result = reasoner.rank([FULL_DAY_SLOT], 30, { now, bufferMinutes: 15 });
    expect(result).toHaveLength(0);
  });

  it("sr-5: 多 slot：上午被排除，下午不变", () => {
    // 早 slot 08:00-10:00（UTC 00:00-02:00）
    const morning = {
      start: iso(Date.UTC(2026, 4, 30, 0, 0, 0)),
      end: iso(Date.UTC(2026, 4, 30, 2, 0, 0)),
    };
    // 晚 slot 19:00-22:00（UTC 11:00-14:00）
    const evening = {
      start: iso(Date.UTC(2026, 4, 30, 11, 0, 0)),
      end: iso(Date.UTC(2026, 4, 30, 14, 0, 0)),
    };
    // now=14:00 上海（UTC 06:00）→ morning 已过，evening 全部可用
    const now = new Date(Date.UTC(2026, 4, 30, 6, 0, 0));
    const result = reasoner.rank([morning, evening], 30, { now });

    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(evening.start);
  });

  it("sr-6: now 落在 slot 起点之前（深夜问明天事） → 仍取 slot.start", () => {
    // now=2026-05-29 23:00 UTC
    const now = new Date(Date.UTC(2026, 4, 29, 23, 0, 0));
    const result = reasoner.rank([FULL_DAY_SLOT], 30, { now });
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(FULL_DAY_SLOT.start);
  });

  it("sr-7: 默认 bufferMinutes=15", () => {
    const now = new Date(Date.UTC(2026, 4, 30, 6, 0, 0));
    const result = reasoner.rank([FULL_DAY_SLOT], 30, { now }); // no buffer override
    const expectedStart = now.getTime() + 15 * 60 * 1000;
    expect(new Date(result[0].start).getTime()).toBe(expectedStart);
  });

  it("sr-8: 自定义 bufferMinutes=30 → 推迟更多", () => {
    const now = new Date(Date.UTC(2026, 4, 30, 6, 0, 0));
    const result = reasoner.rank([FULL_DAY_SLOT], 30, {
      now,
      bufferMinutes: 30,
    });
    const expectedStart = now.getTime() + 30 * 60 * 1000;
    expect(new Date(result[0].start).getTime()).toBe(expectedStart);
  });

  it("sr-9: reason 在 buffer 抬升时切换为 '准备缓冲'", () => {
    const now = new Date(Date.UTC(2026, 4, 30, 6, 0, 0));
    const result = reasoner.rank([FULL_DAY_SLOT], 30, { now });
    expect(result[0].reason).toContain("准备缓冲");

    // 不传 now → 旧 reason
    const legacy = reasoner.rank([FULL_DAY_SLOT], 30);
    expect(legacy[0].reason).toBe("优先使用最近可用时间段");
  });
});
