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
 */
export interface SchedulingRankOptions {
  now?: Date;
  bufferMinutes?: number;
  timeOfDay?: TimeOfDayRange;
  timezone?: string;
}

const DEFAULT_BUFFER_MINUTES = 15;
const DEFAULT_TIMEZONE = "Asia/Shanghai";

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

    // 将 timeOfDay 的本地小时范围转换为当日 UTC 时间戳边界
    let todWindowStart = -Infinity;
    let todWindowEnd = Infinity;
    if (options.timeOfDay && options.now) {
      const anchor = options.now;
      todWindowStart = this.localHourToUtcMs(anchor, options.timeOfDay.startHour, timezone);
      todWindowEnd = this.localHourToUtcMs(anchor, options.timeOfDay.endHour, timezone);
    }

    const ranked: RecommendationCandidate[] = [];

    for (const slot of slots) {
      const slotStart = new Date(slot.start).getTime();
      const slotEnd = new Date(slot.end).getTime();

      // V3.7 P0-3：把 slot 起点抬升到 now+buffer 之后。
      let effectiveStart = Math.max(slotStart, earliestAllowedMs);

      // 时段约束：effectiveStart 不得早于 todWindowStart。
      if (options.timeOfDay) {
        effectiveStart = Math.max(effectiveStart, todWindowStart);
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
   */
  private localHourToUtcMs(anchorDate: Date, localHour: number, timezone: string): number {
    // 取 anchorDate 在目标时区的年月日
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(anchorDate)
      .reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});

    const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
    // 构造一个"假 UTC"然后用 Intl 校正偏移量
    const [year, month, day] = dateStr.split("-").map(Number);
    const roughUtc = new Date(Date.UTC(year, month - 1, day, localHour, 0, 0));

    const localParts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(roughUtc)
      .reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});

    const gotHour = Number(localParts.hour ?? 0);
    const gotMinute = Number(localParts.minute ?? 0);
    const offsetMs = ((gotHour - localHour) * 60 + gotMinute) * 60 * 1000;
    return roughUtc.getTime() - offsetMs;
  }
}
