import type { SemanticFrame, SemanticUserGoal } from "@/agent/types";

const DEFAULT_DURATION_MINUTES = 30;

export interface TimeOfDayRange {
  /** 本地小时（含），0-23 */
  startHour: number;
  /** 本地小时（不含），0-23 */
  endHour: number;
  label: string;
}

export class SemanticFrameParser {
  parse(input: string): SemanticFrame {
    const normalized = input.trim();
    const userGoal = this.detectGoal(normalized);
    const duration = this.parseDuration(normalized);
    const title = this.extractTitle(normalized, userGoal);
    const keyword = this.extractKeyword(normalized, userGoal);
    const startNow = /从现在开始|现在开始|马上开始|立即开始/.test(normalized);
    const timeAnchor = this.parseTimeAnchor(normalized);
    const dateRange = this.parseDateRange(normalized);
    const timeOfDay = timeAnchor ? undefined : this.parseTimeOfDay(normalized);

    const timeExpressions: SemanticFrame["timeExpressions"] = [];
    if (startNow) {
      timeExpressions.push({ sourceText: "从现在开始", normalized: "start_now" });
    } else if (timeAnchor) {
      timeExpressions.push({
        sourceText: timeAnchor.sourceText,
        normalized: "absolute",
        iso: timeAnchor.iso,
      });
    }

    return {
      userGoal,
      objectReferences: keyword
        ? [
            {
              type: /刚刚|刚才|那个|这个|它/.test(normalized)
                ? "recent"
                : "task",
              sourceText: keyword,
              keyword,
            },
          ]
        : [],
      timeExpressions,
      durationExpressions: duration
        ? [{ sourceText: `${duration}分钟`, minutes: duration }]
        : [],
      constraints: timeOfDay ? { timeOfDay } : {},
      userTone: "neutral",
      urgency: startNow ? "high" : "normal",
      missingInfo: [],
      confidence: userGoal === "general_chat" ? 0.5 : 0.86,
      extractedTitle: title,
      category: normalized.includes("写作") ? "writing" : undefined,
      dateRange: dateRange ?? undefined,
    };
  }

  /**
   * 识别"下午/上午/中午/晚上"等时段词（无具体小时时调用）。
   * 有具体时刻时应优先使用 parseTimeAnchor 的结果，不再走此方法。
   */
  parseTimeOfDay(input: string): TimeOfDayRange | undefined {
    if (/下午|午后/.test(input)) {
      return { startHour: 12, endHour: 18, label: "下午" };
    }
    if (/上午/.test(input)) {
      return { startHour: 8, endHour: 12, label: "上午" };
    }
    if (/早上/.test(input)) {
      return { startHour: 8, endHour: 10, label: "早上" };
    }
    if (/中午/.test(input)) {
      return { startHour: 11, endHour: 14, label: "中午" };
    }
    if (/晚上|夜里|傍晚/.test(input)) {
      return { startHour: 18, endHour: 22, label: "晚上" };
    }
    return undefined;
  }

  private detectGoal(input: string): SemanticUserGoal {
    if (/现在.*(时候|时间|几点)|几点了|几点啊|当前时间/.test(input)) {
      return "ask_current_time";
    }

    // V4+: 批量删除（整天/多日）
    if (
      /(删除|删掉|去掉|清空).*(今天|明天|后天|这周|本周|所有).*(任务|待办)/.test(input) ||
      /(今天|明天|后天|这周|本周).*(任务|待办).*(删除|删掉|去掉|清空)/.test(input)
    ) {
      return "batch_delete_tasks";
    }

    if (
      /(删除|删掉|去掉|不要了).*(任务|待办|这个|那个|刚刚|刚才)/.test(input) ||
      /(任务|待办|这个|那个|刚刚|刚才).*(删除|删掉|去掉|不要了)/.test(input) ||
      /^删除.+/.test(input)
    ) {
      return "delete_task";
    }

    // V4+: 延期任务
    if (/(延期|推迟|推到|改到|挪到).*(明天|后天|下周|下午|早上|晚上)/.test(input)) {
      return "defer_task";
    }

    if (/(提醒|提示)我|^提醒/.test(input)) {
      return "create_reminder";
    }

    // V4+: 多日查询
    if (
      /(未来|接下来).*(几天|三天|两天|一周|这周|本周)/.test(input) ||
      /(这周|本周|下周|今天和明天|明天和后天).*任务/.test(input)
    ) {
      return "query_schedule_range";
    }

    if (/(安排在哪|排在哪|什么时候|时间段)/.test(input)) {
      return "query_schedule";
    }

    if (/(任务|待办|安排|排一下|写作)/.test(input)) {
      return "create_and_schedule_task";
    }

    if (input.length > 0) return "general_chat";
    return "general_chat";
  }

  /**
   * V4+: 解析多日日期范围，如"未来三天"、"这周"、"今天和明天"等。
   * 返回 { from, to, sourceText }，from/to 为 "YYYY-MM-DD" 本地日期。
   */
  parseDateRange(input: string): SemanticFrame["dateRange"] {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const toDateKey = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const addDays = (d: Date, n: number) => {
      const r = new Date(d);
      r.setDate(r.getDate() + n);
      return r;
    };
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    if (/未来三天|接下来三天|今天和明天和后天/.test(input)) {
      return {
        from: toDateKey(today),
        to: toDateKey(addDays(today, 2)),
        sourceText: "未来三天",
      };
    }
    if (/未来两天|今天和明天|明天和后天/.test(input)) {
      const offset = /明天和后天/.test(input) ? 1 : 0;
      return {
        from: toDateKey(addDays(today, offset)),
        to: toDateKey(addDays(today, offset + 1)),
        sourceText: input.match(/今天和明天|明天和后天/)?.[0] ?? "未来两天",
      };
    }
    if (/这周|本周/.test(input)) {
      const weekday = today.getDay(); // 0=Sun
      const monOffset = weekday === 0 ? -6 : 1 - weekday;
      const mon = addDays(today, monOffset);
      const sun = addDays(mon, 6);
      return {
        from: toDateKey(mon),
        to: toDateKey(sun),
        sourceText: input.match(/这周|本周/)?.[0] ?? "这周",
      };
    }
    if (/下周/.test(input)) {
      const weekday = today.getDay();
      const monOffset = weekday === 0 ? 1 : 8 - weekday;
      const mon = addDays(today, monOffset);
      const sun = addDays(mon, 6);
      return {
        from: toDateKey(mon),
        to: toDateKey(sun),
        sourceText: "下周",
      };
    }

    return undefined;
  }

  private parseDuration(input: string): number | undefined {
    const minutes = input.match(/(?:大概|约|预计)?\s*(\d+)\s*(?:分钟|分|min)/i);
    if (minutes) return Number(minutes[1]);

    const hours = input.match(/(?:大概|约|预计)?\s*(\d+)\s*(?:小时|h)/i);
    if (hours) return Number(hours[1]) * 60;

    if (/半小时|半个小时/.test(input)) return 30;
    return undefined;
  }

  /**
   * Parse absolute time expressions like:
   * "明天下午三点", "今天14:30", "下午两点半", "明天上午10点"
   * Returns { sourceText, iso } where iso is the inferred UTC ISO string
   * relative to "now" (new Date()).
   */
  parseTimeAnchor(
    input: string
  ): { sourceText: string; iso: string } | undefined {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Day offset
    let dayOffset = 0;
    let dayMatch = "";
    if (/明天/.test(input)) { dayOffset = 1; dayMatch = "明天"; }
    else if (/后天/.test(input)) { dayOffset = 2; dayMatch = "后天"; }
    else if (/今天|今晚|今早/.test(input)) { dayOffset = 0; dayMatch = input.match(/今天|今晚|今早/)?.[0] ?? ""; }

    // Chinese hour words
    const chineseHourMap: Record<string, number> = {
      一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8,
      九: 9, 十: 10, 十一: 11, 十二: 12,
    };

    // AM/PM modifier
    let periodOffset = 0;
    let periodMatch = "";
    if (/上午|早上/.test(input)) { periodOffset = 0; periodMatch = input.match(/上午|早上/)?.[0] ?? ""; }
    else if (/下午|傍晚/.test(input)) { periodOffset = 12; periodMatch = input.match(/下午|傍晚/)?.[0] ?? ""; }
    else if (/晚上|夜里/.test(input)) { periodOffset = 12; periodMatch = input.match(/晚上|夜里/)?.[0] ?? ""; }
    else if (/中午/.test(input)) { periodOffset = 0; periodMatch = "中午"; }

    // Numeric time "14:30" or "14点30"
    const numericMatch = input.match(/(\d{1,2})[:：点时](\d{0,2})/);
    if (numericMatch) {
      let hour = Number(numericMatch[1]);
      const minute = numericMatch[2] ? Number(numericMatch[2]) : 0;
      if (periodOffset === 12 && hour < 12) hour += 12;
      if (periodOffset === 0 && periodMatch === "中午" && hour < 12) hour = 12;

      const target = new Date(today);
      target.setDate(today.getDate() + dayOffset);
      target.setHours(hour, minute, 0, 0);

      const sourceText = `${dayMatch}${periodMatch}${numericMatch[0]}`;
      return { sourceText, iso: target.toISOString() };
    }

    // Chinese hour word "三点", "两点半"
    const chineseTimeRe = new RegExp(
      `(${Object.keys(chineseHourMap).join("|")})点(半)?`
    );
    const chineseMatch = input.match(chineseTimeRe);
    if (chineseMatch) {
      let hour = chineseHourMap[chineseMatch[1]] ?? 0;
      const halfHour = chineseMatch[2] === "半";
      if (periodOffset === 12 && hour < 12) hour += 12;
      if (periodOffset === 0 && periodMatch === "中午" && hour < 12) hour = 12;

      const target = new Date(today);
      target.setDate(today.getDate() + dayOffset);
      target.setHours(hour, halfHour ? 30 : 0, 0, 0);

      const sourceText = `${dayMatch}${periodMatch}${chineseMatch[0]}`;
      return { sourceText, iso: target.toISOString() };
    }

    // Only day offset without time (e.g. "明天" alone) — return undefined so upstream treats as no anchor
    return undefined;
  }

  private extractTitle(
    input: string,
    userGoal: SemanticUserGoal
  ): string | undefined {
    if (
      userGoal !== "create_and_schedule_task" &&
      userGoal !== "create_reminder" &&
      userGoal !== "delete_task"
    ) {
      return undefined;
    }

    // For reminder: extract what comes after "提醒我...开/做/..."
    if (userGoal === "create_reminder") {
      const reminderMatch = input.match(/提醒(?:我)?(.+?)(?:的?事|$)/);
      if (reminderMatch) {
        const raw = reminderMatch[1].trim().replace(/^(要|去|把|在|[^\w])+/, "");
        return raw || "提醒";
      }
      return "提醒";
    }

    const taskMatch = input.match(/(.+?)(?:任务|待办)/);
    let raw = (taskMatch?.[1] ?? "").trim();

    const FILLERS = [
      "我", "现在", "有一个", "有个", "有", "一个", "个",
      "临时的", "临时", "帮我", "给我", "创建", "安排",
      "排一个", "排个", "新建", "添加", "删除", "删掉",
    ];
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of FILLERS) {
        if (raw.startsWith(f)) {
          raw = raw.slice(f.length).trimStart();
          changed = true;
        }
      }
    }

    return raw ? `${raw}任务` : "新任务";
  }

  private extractKeyword(
    input: string,
    userGoal: SemanticUserGoal
  ): string | undefined {
    if (
      userGoal === "create_and_schedule_task" ||
      userGoal === "delete_task"
    ) {
      return this.extractTitle(input, userGoal);
    }

    if (userGoal !== "query_schedule") return undefined;

    if (/刚刚|刚才|那个|这个|它/.test(input)) return "刚刚那个任务";

    const keywordMatch = input.match(/(.+?任务)/);
    return keywordMatch?.[1]?.trim();
  }

  getDurationOrDefault(frame: SemanticFrame): number {
    return frame.durationExpressions[0]?.minutes ?? DEFAULT_DURATION_MINUTES;
  }
}
