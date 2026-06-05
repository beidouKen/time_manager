const MS_PER_MINUTE = 60 * 1000;

/**
 * 将毫秒时间戳向上对齐到 stepMinutes 分钟边界（不向下取整）。
 * 例：10:41 → 10:45（step=5），10:45 → 10:45，10:59 → 11:00。
 */
export function roundUpToMinuteBoundary(ms: number, stepMinutes = 5): number {
  if (!Number.isFinite(ms) || stepMinutes <= 0) return ms;
  const stepMs = stepMinutes * MS_PER_MINUTE;
  const remainder = ms % stepMs;
  return remainder === 0 ? ms : ms + (stepMs - remainder);
}
