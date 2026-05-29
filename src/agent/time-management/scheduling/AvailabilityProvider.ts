import type { TimeBlockService } from "@/services/TimeBlockService";

export interface AvailabilitySlot {
  start: string;
  end: string;
}

export class AvailabilityProvider {
  constructor(private timeBlockService: TimeBlockService) {}

  async getAvailability(date: Date): Promise<AvailabilitySlot[]> {
    const blocks = await this.timeBlockService.getBlocksForDate(date);
    const active = blocks
      .filter((b) => !b.deleted_at)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const dayStart = new Date(date);
    dayStart.setHours(8, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(22, 0, 0, 0);

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
