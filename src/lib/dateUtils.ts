import {
  format,
  parseISO,
  startOfDay,
  endOfDay,
  isValid,
  differenceInMinutes,
  addMinutes,
  formatISO,
  isBefore,
  isAfter,
  areIntervalsOverlapping,
} from "date-fns";
import { zhCN } from "date-fns/locale";

export function formatDate(date: Date | string, pattern = "yyyy-MM-dd"): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, pattern, { locale: zhCN });
}

export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "HH:mm");
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "MM-dd HH:mm");
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
}

export function getDayRange(date: Date): { start: Date; end: Date } {
  return {
    start: startOfDay(date),
    end: endOfDay(date),
  };
}

export function toISOString(date: Date): string {
  return formatISO(date);
}

export function parseDate(isoString: string): Date {
  return parseISO(isoString);
}

export function isValidDate(date: unknown): boolean {
  if (typeof date !== "string") return false;
  const d = parseISO(date);
  return isValid(d);
}

export function getBlockDurationMinutes(
  startTime: string,
  endTime: string
): number {
  return differenceInMinutes(parseISO(endTime), parseISO(startTime));
}

export function combineDateAndTime(date: Date, timeString: string): Date {
  const [hours, minutes] = timeString.split(":").map(Number);
  const result = startOfDay(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function addMinutesToDate(date: Date, minutes: number): Date {
  return addMinutes(date, minutes);
}

export function doIntervalsOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  return areIntervalsOverlapping(
    { start: parseISO(start1), end: parseISO(end1) },
    { start: parseISO(start2), end: parseISO(end2) }
  );
}

export function isBeforeTime(a: string, b: string): boolean {
  return isBefore(parseISO(a), parseISO(b));
}

export function isAfterTime(a: string, b: string): boolean {
  return isAfter(parseISO(a), parseISO(b));
}

// Calculate Y position for a time block on the timeline
// HOUR_HEIGHT = 60px per hour
export const HOUR_HEIGHT = 60;

export function getBlockTopPx(startTime: string, dayStart: Date): number {
  const start = parseISO(startTime);
  const minutesFromDayStart = differenceInMinutes(start, dayStart);
  return (minutesFromDayStart / 60) * HOUR_HEIGHT;
}

export function getBlockHeightPx(startTime: string, endTime: string): number {
  const minutes = getBlockDurationMinutes(startTime, endTime);
  return Math.max((minutes / 60) * HOUR_HEIGHT, 20); // min 20px
}
