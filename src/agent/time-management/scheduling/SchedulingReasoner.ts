import type { AvailabilitySlot } from "@/agent/time-management/scheduling/AvailabilityProvider";

export interface RecommendationCandidate {
  start: string;
  end: string;
  reason: string;
}

export class SchedulingReasoner {
  rank(
    slots: AvailabilitySlot[],
    durationMinutes: number
  ): RecommendationCandidate[] {
    const durationMs = durationMinutes * 60 * 1000;
    const ranked: RecommendationCandidate[] = [];

    for (const slot of slots) {
      const start = new Date(slot.start).getTime();
      const end = new Date(slot.end).getTime();
      if (end - start < durationMs) continue;

      ranked.push({
        start: new Date(start).toISOString(),
        end: new Date(start + durationMs).toISOString(),
        reason: "优先使用最近可用时间段",
      });
    }

    return ranked.slice(0, 3);
  }
}
