import {
  AvailabilityProvider,
  type AvailabilitySlot,
} from "@/agent/time-management/scheduling/AvailabilityProvider";
import {
  SchedulingReasoner,
  type RecommendationCandidate,
} from "@/agent/time-management/scheduling/SchedulingReasoner";
import type { TimeOfDayRange } from "@/agent/experience/SemanticFrameParser";

/**
 * V3.8+: 推荐结果元数据，告诉调用方候选是否被自动顺延到次日。
 */
export interface PlanResult {
  candidates: RecommendationCandidate[];
  /** 实际推荐使用的日期（已应用 auto-shift 后的目标日期）；ISO 日期前缀 YYYY-MM-DD（本地时区） */
  effectiveDateKey?: string;
  /** 当今日时段窗口已完全过去时，是否自动顺延到了次日 */
  shiftedToNextDay: boolean;
  /**
   * V3.8+ Past Time Disambiguation:
   * true = 用户明确指定了"今天"，但该时段已过，且 allowShiftToNextDay=false。
   * 调用方应向用户追问：是补记今天的记录，还是安排到明天同一时段？
   */
  needsPastTimeClarification?: boolean;
}

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
   *
   * 返回平铺数组以保持向后兼容；调用方需要 shift 元数据时请用 planWithMeta。
   */
  async plan(args: {
    date: Date;
    durationMinutes: number;
    timezone?: string;
    now?: Date;
    bufferMinutes?: number;
    timeOfDay?: TimeOfDayRange;
  }): Promise<RecommendationCandidate[]> {
    const result = await this.planWithMeta(args);
    return result.candidates;
  }

  /**
   * V3.8+: 带元数据的推荐入口。
   *
   * ### 优先级规则（V3.8+ Past Time Disambiguation）
   *
   * 1. 明确日期 > 时段 > 当前时间是否已过
   * 2. `allowShiftToNextDay = false`（用户说了"今天"）：
   *    - 今日时段未过 → 正常推荐今天的候选
   *    - 今日时段已过 + `allowPastTime = false` → `needsPastTimeClarification = true`
   *    - 今日时段已过 + `allowPastTime = true`（补记）→ 以过去时段推荐（忽略 now 过滤）
   * 3. `allowShiftToNextDay = true`（用户明确要求下一个/之后时段）：
   *    - 今日时段已过 → 自动顺延到次日同一时段，`shiftedToNextDay = true`
   * 4. 无明确日期且 `allowShiftToNextDay = false`（默认）：
   *    - 今日时段已过 → `needsPastTimeClarification = true`，不顺延
   */
  async planWithMeta(args: {
    date: Date;
    durationMinutes: number;
    timezone?: string;
    now?: Date;
    bufferMinutes?: number;
    timeOfDay?: TimeOfDayRange;
    /**
     * 是否允许在今日时段已过时自动顺延到次日。
     * 默认 false（无明确日期不顺延）。
     * 仅用户明确要求下一个/之后时段时设为 true。
     */
    allowShiftToNextDay?: boolean;
    /**
     * 是否允许推荐已过去的时间段（补记模式）。
     * 为 true 时，SchedulingReasoner 不过滤 now 之前的槽位。
     * 默认 false。
     */
    allowPastTime?: boolean;
  }): Promise<PlanResult> {
    const timezone = args.timezone ?? "Asia/Shanghai";
    const now = args.now ?? new Date();
    const allowShiftToNextDay = args.allowShiftToNextDay === true;
    const allowPastTime = args.allowPastTime === true;

    // 补记模式：不过滤 now 之前的槽位，让 Reasoner 从当天 08:00 起搜索历史可用段
    const effectiveNow = allowPastTime ? undefined : now;

    const first = await this.runOnce(args.date, args, effectiveNow, timezone, args.date);
    if (first.length > 0) {
      return {
        candidates: first,
        effectiveDateKey: this.dateKey(args.date, timezone),
        shiftedToNextDay: false,
      };
    }

    // 没有候选时，检查今日时段是否已过
    if (args.timeOfDay && this.isTimeOfDayPast(args.date, args.timeOfDay, now, timezone)) {
      if (!allowShiftToNextDay) {
        // 用户明确指定了今天且时段已过、非补记 → 需要追问
        return {
          candidates: [],
          effectiveDateKey: this.dateKey(args.date, timezone),
          shiftedToNextDay: false,
          needsPastTimeClarification: true,
        };
      }
      // 允许顺延到次日重试一次。
      // 把 nextDay 作为 dateAnchor 传给 reasoner，否则 todWindow 仍停在 args.date 当天。
      const nextDay = new Date(args.date.getTime() + 24 * 60 * 60 * 1000);
      const second = await this.runOnce(nextDay, args, now, timezone, nextDay);
      return {
        candidates: second,
        effectiveDateKey: this.dateKey(nextDay, timezone),
        shiftedToNextDay: second.length > 0,
      };
    }

    return {
      candidates: [],
      effectiveDateKey: this.dateKey(args.date, timezone),
      shiftedToNextDay: false,
    };
  }

  private async runOnce(
    date: Date,
    args: {
      durationMinutes: number;
      bufferMinutes?: number;
      timeOfDay?: TimeOfDayRange;
    },
    now: Date | undefined,
    timezone: string,
    dateAnchor: Date
  ): Promise<RecommendationCandidate[]> {
    const availability: AvailabilitySlot[] =
      await this.availabilityProvider.getAvailability(
        date,
        timezone,
        now ? { now } : {}
      );
    return this.reasoner.rank(availability, args.durationMinutes, {
      now,
      bufferMinutes: args.bufferMinutes,
      timeOfDay: args.timeOfDay,
      timezone,
      dateAnchor,
    });
  }

  /** 取指定时区下 date 的 YYYY-MM-DD */
  private dateKey(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  /**
   * 判断 args.date 当天的 timeOfDay 窗口是否已完全过去（now + buffer >= window.end）。
   */
  private isTimeOfDayPast(
    date: Date,
    timeOfDay: TimeOfDayRange,
    now: Date,
    timezone: string
  ): boolean {
    const endLocal = this.localHourToUtcMs(date, timeOfDay.endHour, timezone);
    return now.getTime() >= endLocal;
  }

  /**
   * 将"目标日期在目标时区的 localHour:00"转成 UTC 毫秒时间戳。
   *
   * 旧实现只比较小时分钟，遇到本地时刻越过 UTC 日界（如上海 22:00 = UTC 14:00
   * 同日，但 Date.UTC(...,22,0,0) 在 UTC+8 看到的是次日 06:00）时会算错一天。
   * 这里改成抽全部 Y/M/D/H/M 来做"locally-as-UTC vs 真实-UTC"的差值，规避跨日 bug。
   */
  private localHourToUtcMs(
    anchorDate: Date,
    localHour: number,
    timezone: string
  ): number {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(anchorDate)
      .reduce<Record<string, string>>((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
    const [year, month, day] = [
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
    ];
    const roughUtc = Date.UTC(year, month, day, localHour, 0, 0);

    // 取 roughUtc 在目标时区的完整 Y/M/D/H/M
    const localParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(roughUtc))
      .reduce<Record<string, string>>((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
    // Intl 在某些时区/小时（如 24）会输出 hour=24，归一到 0
    const gotHour = Number(localParts.hour ?? 0) % 24;
    const gotMinute = Number(localParts.minute ?? 0);
    const gotYear = Number(localParts.year ?? year);
    const gotMonth = Number(localParts.month ?? 1) - 1;
    const gotDay = Number(localParts.day ?? day);
    const localAsUtc = Date.UTC(gotYear, gotMonth, gotDay, gotHour, gotMinute, 0);
    const offsetMs = localAsUtc - roughUtc;
    return roughUtc - offsetMs;
  }
}
