import {
  AvailabilityProvider,
  type AvailabilitySlot,
} from "@/agent/time-management/scheduling/AvailabilityProvider";
import {
  SchedulingReasoner,
  type RecommendationCandidate,
} from "@/agent/time-management/scheduling/SchedulingReasoner";
import type { TimeOfDayRange } from "@/agent/experience/SemanticFrameParser";

export class RecommendationPlanner {
  constructor(
    private availabilityProvider: AvailabilityProvider,
    private reasoner: SchedulingReasoner
  ) {}

  /**
   * V3.7 P0-3：plan() 现在显式接收 `now`，并把它透传给 SchedulingReasoner，
   * 以保证 "未指定时间时不得推荐过去时间"。
   *
   * 调用方（TimeManagementAgent）应传入 `new Date(context.currentDatetime)`。
   * 若 now 未提供（向后兼容），fallback 用 Date()。
   *
   * timeOfDay: 可选时段约束（如"下午"），透传给 SchedulingReasoner 进行过滤。
   */
  async plan(args: {
    date: Date;
    durationMinutes: number;
    timezone?: string;
    now?: Date;
    bufferMinutes?: number;
    timeOfDay?: TimeOfDayRange;
  }): Promise<RecommendationCandidate[]> {
    const timezone = args.timezone ?? "Asia/Shanghai";
    const now = args.now ?? new Date();
    const availability: AvailabilitySlot[] =
      await this.availabilityProvider.getAvailability(args.date, timezone, {
        now,
      });
    return this.reasoner.rank(availability, args.durationMinutes, {
      now,
      bufferMinutes: args.bufferMinutes,
      timeOfDay: args.timeOfDay,
      timezone,
    });
  }
}
