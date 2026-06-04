import type { AvailabilitySlot } from "@/agent/time-management/scheduling/AvailabilityProvider";
import type { TimeOfDayRange } from "@/agent/experience/SemanticFrameParser";

export interface RecommendationCandidate {
  start: string;
  end: string;
  reason: string;
}

/**
 * V3.7 P0-3：推荐排序参数。
 * - now: 当前时间。提供后启用 "不得推荐过去时间" 策略。
 * - bufferMinutes: 默认 15 分钟，避免推荐刚刚到不及反应的时间点。
 * - timeOfDay: 用户指定的时段（如"下午"），仅在该时段内推荐。
 * - timezone: 用于将 timeOfDay 的小时范围转换为 UTC。
 * - dateAnchor: V3.8+，计算 timeOfDay 窗口边界使用的"日期锚点"。
 *   默认等于 `now`。当 RecommendationPlanner 因为今日时段已过而切换到次日
 *   时，会传入次日 Date，避免 todWindow 还停留在今天。
 */
export interface SchedulingRankOptions {
  now?: Date;
  bufferMinutes?: number;
  timeOfDay?: TimeOfDayRange;
  timezone?: string;
  dateAnchor?: Date;
}

const DEFAULT_BUFFER_MINUTES = 15;
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const MS_PER_MINUTE = 60 * 1000;

/**
 * V3.8: 把毫秒时间戳向上对齐到下一个分钟边界。
 * 避免 18:00:36 这种带秒的 effectiveStart 被显示为 "18:00" 但实际比整点晚 36 秒，
 * 也避免下一次 refine 时刻递增 1 分钟（18:00 → 18:01 → 18:02）。
 */
function ceilToMinute(ms: number): number {
  if (ms === -Infinity || ms === Infinity) return ms;
  const remainder = ms % MS_PER_MINUTE;
  return remainder === 0 ? ms : ms + (MS_PER_MINUTE - remainder);
}

export class SchedulingReasoner {
  rank(
    slots: AvailabilitySlot[],
    durationMinutes: number,
    options: SchedulingRankOptions = {}
  ): RecommendationCandidate[] {
    const durationMs = durationMinutes * 60 * 1000;
    const bufferMinutes = options.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
    const earliestAllowedMs = options.now
      ? options.now.getTime() + bufferMinutes * 60 * 1000
      : -Infinity;
    const timezone = options.timezone ?? DEFAULT_TIMEZONE;

    // 将 timeOfDay 的本地小时范围转换为目标日期的 UTC 时间戳边界。
    // dateAnchor（若提供）优先于 now，使 RecommendationPlanner 顺延到次日时
    // 能用次日日期作为窗口锚点（否则窗口仍停在今天就会被 effectiveStart 一脚踢飞）。
    let todWindowStart = -Infinity;
    let todWindowEnd = Infinity;
    if (options.timeOfDay && (options.dateAnchor || options.now)) {
      const anchor = options.dateAnchor ?? options.now!;
      todWindowStart = this.localHourToUtcMs(anchor, options.timeOfDay.startHour, timezone);
      todWindowEnd = this.localHourToUtcMs(anchor, options.timeOfDay.endHour, timezone);
    }

    const ranked: RecommendationCandidate[] = [];

    for (const slot of slots) {
      const slotStart = new Date(slot.start).getTime();
      const slotEnd = new Date(slot.end).getTime();

      // V3.7 P0-3：把 slot 起点抬升到 now+buffer 之后。
      // V3.8：进一步向上对齐到下一分钟边界，避免推荐出现 18:00:36 这种碎秒，
      // 同时让连续 refine 不会每次漂 1 分钟。
      let effectiveStart = ceilToMinute(Math.max(slotStart, earliestAllowedMs));

      // 时段约束：effectiveStart 不得早于 todWindowStart。
      if (options.timeOfDay) {
        effectiveStart = ceilToMinute(Math.max(effectiveStart, todWindowStart));
        // slot 在时段窗口之后，跳过
        if (effectiveStart >= todWindowEnd) continue;
        // slot 结束不得晚于时段窗口结束
        const effectiveEnd = Math.min(slotEnd, todWindowEnd);
        if (effectiveEnd - effectiveStart < durationMs) continue;

        ranked.push({
          start: new Date(effectiveStart).toISOString(),
          end: new Date(effectiveStart + durationMs).toISOString(),
          reason: `在${options.timeOfDay.label}可用时间段安排`,
        });
        continue;
      }

      if (slotEnd - effectiveStart < durationMs) continue;

      ranked.push({
        start: new Date(effectiveStart).toISOString(),
        end: new Date(effectiveStart + durationMs).toISOString(),
        reason:
          options.now && effectiveStart > slotStart
            ? "在最近可用时间段后留出准备缓冲"
            : "优先使用最近可用时间段",
      });
    }

    return ranked.slice(0, 3);
  }

  /**
   * 将某天（由 anchorDate 确定日期）+ 本地小时 转换为 UTC 毫秒时间戳。
   *
   * V3.8+ 修复：旧实现仅比较小时分钟，遇到本地时刻越过 UTC 日界（如上海 18:00 = 同日 UTC 10:00，
   * 但 Date.UTC(year, m, d, 18) 在 UTC+8 看到的是次日 02:00）时偏差一整天。
   * 这里改用全 Y/M/D/H/M 字段计算 "locally-as-UTC - 真实-UTC" 的偏移量，避免跨日 bug。
   */
  private localHourToUtcMs(anchorDate: Date, localHour: number, timezone: string): number {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(anchorDate)
      .reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});

    const year = Number(parts.year);
    const month = Number(parts.month) - 1;
    const day = Number(parts.day);
    const roughUtc = Date.UTC(year, month, day, localHour, 0, 0);

    const localParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(roughUtc))
      .reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});

    const gotYear = Number(localParts.year ?? year);
    const gotMonth = Number(localParts.month ?? 1) - 1;
    const gotDay = Number(localParts.day ?? day);
    const gotHour = Number(localParts.hour ?? 0) % 24;
    const gotMinute = Number(localParts.minute ?? 0);

    const localAsUtc = Date.UTC(gotYear, gotMonth, gotDay, gotHour, gotMinute, 0);
    const offsetMs = localAsUtc - roughUtc;
    return roughUtc - offsetMs;
  }
}
