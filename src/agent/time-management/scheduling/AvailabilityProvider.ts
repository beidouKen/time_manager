import type { TimeBlockService } from "@/services/TimeBlockService";

export interface AvailabilitySlot {
  start: string;
  end: string;
}

/**
 * Compute start (08:00) and end (22:00) of a day in the given timezone,
 * returning UTC ISO strings.
 */
function zonedDayBounds(
  date: Date,
  timezone: string
): { dayStart: Date; dayEnd: Date } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDateStr = formatter.format(date); // "YYYY-MM-DD"

  return {
    dayStart: localStringToUtc(localDateStr, 8, 0, timezone),
    dayEnd: localStringToUtc(localDateStr, 22, 0, timezone),
  };
}

/**
 * Convert a local date + hour/minute in a given timezone to a UTC Date.
 */
function localStringToUtc(
  dateKey: string, // "YYYY-MM-DD"
  hour: number,
  minute: number,
  timezone: string
): Date {
  // Build a rough ISO string, then correct with Intl offset detection
  const [year, month, day] = dateKey.split("-").map(Number);

  // Create a Date representing midnight UTC on that date, then find the
  // timezone offset at that instant to compute the correct UTC time.
  const utcMidnight = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // Get the local time string in that timezone for utcMidnight
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  })
    .formatToParts(utcMidnight)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const localHour = Number(localParts.hour ?? 0);
  const localMinute = Number(localParts.minute ?? 0);

  // Offset in minutes: what we got vs what we wanted
  const offsetMinutes =
    (localHour - hour) * 60 + (localMinute - minute);

  return new Date(utcMidnight.getTime() - offsetMinutes * 60 * 1000);
}

export class AvailabilityProvider {
  constructor(private timeBlockService: TimeBlockService) {}

  /**
   * 计算指定日期的空闲段。
   *
   * V3.7 P0-3：可选参数 `now` 用于跳过已过去的部分日窗。
   * 调用方传入 now 后，slot 起点会被抬到 max(dayStart, now)，
   * 减少对 SchedulingReasoner 的无效输入。Reasoner 中再做 buffer 抬升。
   *
   * 不传 now（旧用法）保持原行为，便于 V4+ 多日预览这种需要看完整日窗的场景。
   */
  async getAvailability(
    date: Date,
    timezone = "Asia/Shanghai",
    options: { now?: Date } = {}
  ): Promise<AvailabilitySlot[]> {
    const blocks = await this.timeBlockService.getBlocksForDate(date);
    const active = blocks
      .filter((b) => !b.deleted_at)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const { dayStart, dayEnd } = zonedDayBounds(date, timezone);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();

    // 如果当前时间已晚于日窗结束（如 23:00 之后问明天的事）→ 不裁剪，让 Reasoner 处理。
    // 如果 now 落在日窗内 → 把 cursor 抬升，减少完全位于过去的 slot。
    const nowMs = options.now ? options.now.getTime() : -Infinity;
    const isNowInsideDay = nowMs >= dayStartMs && nowMs < dayEndMs;
    const initialCursor = isNowInsideDay
      ? Math.max(dayStartMs, nowMs)
      : dayStartMs;

    if (active.length === 0) {
      if (initialCursor >= dayEndMs) return [];
      return [
        { start: new Date(initialCursor).toISOString(), end: dayEnd.toISOString() },
      ];
    }

    const slots: AvailabilitySlot[] = [];
    let cursor = initialCursor;
    for (const block of active) {
      const blockStart = new Date(block.start_time).getTime();
      const blockEnd = new Date(block.end_time).getTime();
      if (blockStart > cursor) {
        slots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(blockStart).toISOString(),
        });
      }
      cursor = Math.max(cursor, blockEnd);
    }

    if (cursor < dayEndMs) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: dayEnd.toISOString(),
      });
    }

    return slots;
  }
}
