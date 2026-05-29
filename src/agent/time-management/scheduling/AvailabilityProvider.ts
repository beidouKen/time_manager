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

  async getAvailability(
    date: Date,
    timezone = "Asia/Shanghai"
  ): Promise<AvailabilitySlot[]> {
    const blocks = await this.timeBlockService.getBlocksForDate(date);
    const active = blocks
      .filter((b) => !b.deleted_at)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const { dayStart, dayEnd } = zonedDayBounds(date, timezone);

    if (active.length === 0) {
      return [{ start: dayStart.toISOString(), end: dayEnd.toISOString() }];
    }

    const slots: AvailabilitySlot[] = [];
    let cursor = dayStart.getTime();
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

    if (cursor < dayEnd.getTime()) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: dayEnd.toISOString(),
      });
    }

    return slots;
  }
}
