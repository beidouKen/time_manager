export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatChineseDateTime(
  isoString: string,
  timezone: string
): string {
  const parts = getDateTimeParts(isoString, timezone);
  return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日 ${parts.hour}:${parts.minute}`;
}

export function formatTimeInZone(isoString: string, timezone: string): string {
  const parts = getDateTimeParts(isoString, timezone);
  return `${parts.hour}:${parts.minute}`;
}

function getDateTimeParts(
  isoString: string,
  timezone: string
): Record<string, string> {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    // 返回占位符，避免崩溃
    return { year: "--", month: "--", day: "--", hour: "--", minute: "--" };
  }

  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return Object.fromEntries(
    formatter.formatToParts(date).map((part) => [
      part.type,
      part.value,
    ])
  );
}
