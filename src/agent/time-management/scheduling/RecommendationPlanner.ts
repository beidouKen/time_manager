import {
  AvailabilityProvider,
  type AvailabilitySlot,
} from "@/agent/time-management/scheduling/AvailabilityProvider";
import {
  SchedulingReasoner,
  type RecommendationCandidate,
} from "@/agent/time-management/scheduling/SchedulingReasoner";

export class RecommendationPlanner {
  constructor(
    private availabilityProvider: AvailabilityProvider,
    private reasoner: SchedulingReasoner
  ) {}

  async plan(args: {
    date: Date;
    durationMinutes: number;
    timezone?: string;
  }): Promise<RecommendationCandidate[]> {
    const timezone = args.timezone ?? "Asia/Shanghai";
    const availability: AvailabilitySlot[] =
      await this.availabilityProvider.getAvailability(args.date, timezone);
    return this.reasoner.rank(availability, args.durationMinutes);
  }
}
