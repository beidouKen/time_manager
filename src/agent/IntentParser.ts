/**
 * @deprecated dead since V3.6.1; not imported anywhere as of Agent V3;
 * scheduled for removal post Agent V5.
 * Active rule-based parsing is now in SemanticFrameParser.ts.
 */
import type { ParsedIntent, IntentType } from "@/agent/types";

interface PatternRule {
  intent: IntentType;
  patterns: RegExp[];
  extractArgs: (input: string, match: RegExpMatchArray) => Record<string, unknown>;
}

const DURATION_PATTERNS: Record<string, RegExp> = {
  hours: /(\d+)\s*(?:个?小时|h)/,
  minutes: /(\d+)\s*(?:分钟|分|min)/,
  hoursAndMinutes: /(\d+)\s*(?:个?小时|h)\s*(\d+)\s*(?:分钟|分|min)/,
};

const TIME_KEYWORDS: Record<string, { hour: number; minute: number }> = {
  早上: { hour: 8, minute: 0 },
  上午: { hour: 9, minute: 0 },
  中午: { hour: 12, minute: 0 },
  下午: { hour: 14, minute: 0 },
  傍晚: { hour: 17, minute: 0 },
  晚上: { hour: 19, minute: 0 },
};

const DATE_KEYWORDS: Record<string, () => Date> = {
  今天: () => new Date(),
  明天: () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  },
  后天: () => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d;
  },
};

function parseDuration(input: string): number | undefined {
  const hm = input.match(DURATION_PATTERNS.hoursAndMinutes);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);

  const h = input.match(DURATION_PATTERNS.hours);
  if (h) return parseInt(h[1]) * 60;

  const m = input.match(DURATION_PATTERNS.minutes);
  if (m) return parseInt(m[1]);

  // Handle Chinese number patterns like "两个小时"
  const chineseHours = input.match(/(两|三|四|五|六|七|八)\s*(?:个?小时)/);
  if (chineseHours) {
    const numMap: Record<string, number> = {
      两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8,
    };
    return (numMap[chineseHours[1]] ?? 2) * 60;
  }

  const halfHour = input.match(/半\s*(?:个?小时|h)/);
  if (halfHour) return 30;

  return undefined;
}

function parseDate(input: string): string | undefined {
  for (const [keyword, factory] of Object.entries(DATE_KEYWORDS)) {
    if (input.includes(keyword)) {
      return factory().toISOString().split("T")[0];
    }
  }

  const dateMatch = input.match(/(\d{1,2})[月/\-.](\d{1,2})[日号]?/);
  if (dateMatch) {
    const now = new Date();
    const month = parseInt(dateMatch[1]) - 1;
    const day = parseInt(dateMatch[2]);
    const d = new Date(now.getFullYear(), month, day);
    return d.toISOString().split("T")[0];
  }

  return undefined;
}

function parseTimeOfDay(input: string): string | undefined {
  // Explicit time like "3点" "15:00" "下午3点"
  const explicitTime = input.match(/(\d{1,2})\s*[:：点]\s*(\d{0,2})/);
  if (explicitTime) {
    let hour = parseInt(explicitTime[1]);
    const minute = explicitTime[2] ? parseInt(explicitTime[2]) : 0;
    // If "下午" or "晚上" prefix and hour < 12, add 12
    if (hour < 12 && (input.includes("下午") || input.includes("晚上"))) {
      hour += 12;
    }
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  }

  for (const [keyword, time] of Object.entries(TIME_KEYWORDS)) {
    if (input.includes(keyword)) {
      return `${time.hour.toString().padStart(2, "0")}:${time.minute.toString().padStart(2, "0")}`;
    }
  }

  return undefined;
}

function extractTaskTitle(input: string): string {
  // Remove common prefixes/suffixes and time expressions
  let title = input
    .replace(
      /^(帮我|请|麻烦|我想|我要|给我|帮忙)?(创建|新建|添加|安排|设置|做一个?)/,
      ""
    )
    .replace(/任务[：:]?\s*/, "")
    .replace(/(今天|明天|后天|早上|上午|中午|下午|傍晚|晚上)/, "")
    .replace(/(\d+个?小时|\d+分钟|两个?小时|半个?小时)/, "")
    .replace(/(帮我|请|安排|到|的时间)/, "")
    .trim();

  // If after stripping there's nothing useful, try a different approach
  if (title.length < 2) {
    // Try to find the content after specific markers
    const afterColon = input.match(/[：:]\s*(.+)/);
    if (afterColon) return afterColon[1].trim();

    const afterVerb = input.match(/(?:安排|创建|新建|添加)(.+?)(?:任务|$)/);
    if (afterVerb) return afterVerb[1].trim();

    return input.trim();
  }

  return title;
}

const RULES: PatternRule[] = [
  {
    intent: "schedule_task",
    patterns: [
      /(?:帮我|请|我想)?安排.+(?:小时|分钟|分|h|min)/,
      /(?:帮我|请)?(?:把|将).+安排到/,
      /(?:帮我|请)?安排.+(?:到|在).+(?:今天|明天|后天|早上|上午|下午|晚上)/,
    ],
    extractArgs: (input) => ({
      title: extractTaskTitle(input),
      duration: parseDuration(input),
      date: parseDate(input),
      timeOfDay: parseTimeOfDay(input),
    }),
  },
  {
    intent: "create_task",
    patterns: [
      /(?:帮我|请|我想|我要)?(?:创建|新建|添加|建)一?个?任务/,
      /(?:帮我|请)?(?:记录|记一下|加一个)/,
    ],
    extractArgs: (input) => ({
      title: extractTaskTitle(input),
      priority: input.includes("紧急")
        ? "urgent"
        : input.includes("重要")
          ? "high"
          : undefined,
      duration: parseDuration(input),
      deadline: parseDate(input),
    }),
  },
  {
    intent: "mark_task_completed",
    patterns: [
      /(?:把|将)?.+(?:标记为|标为|设为|改为)(?:完成|已完成|done)/,
      /(?:完成了?|做完了?).+/,
      /.+(?:完成了|做完了|搞定了)/,
    ],
    extractArgs: (input) => {
      const titleMatch = input.match(
        /(?:把|将)\s*[「"'《]?(.+?)[」"'》]?\s*(?:标记|标为|设为|改为)/
      );
      return {
        titleKeyword: titleMatch?.[1]?.trim() || input.replace(/(?:标记为|标为|设为|改为|完成了?|做完了?|搞定了)/g, "").trim(),
      };
    },
  },
  {
    intent: "delete_task",
    patterns: [
      /(?:帮我|请)?删除.+任务/,
      /(?:帮我|请)?(?:把|将)?.+(?:删掉|删除|移除)/,
      /(?:帮我|请)?删除(?:这个|那个)任务/,
    ],
    extractArgs: (input) => {
      const titleMatch = input.match(
        /删除\s*[「"'《]?(.+?)[」"'》]?\s*(?:任务|$)/
      );
      return {
        titleKeyword: titleMatch?.[1]?.replace(/(?:这个|那个|任务)/g, "").trim() || undefined,
      };
    },
  },
  {
    intent: "delete_time_block",
    patterns: [
      /(?:帮我|请)?删除.+时间块/,
      /(?:帮我|请)?(?:取消|删除)(?:这个|那个)?(?:安排|时间块|时间段)/,
    ],
    extractArgs: (input) => ({
      titleKeyword: input.replace(/(?:帮我|请|删除|取消|这个|那个|安排|时间块|时间段)/g, "").trim() || undefined,
    }),
  },
  {
    intent: "list_tasks",
    patterns: [
      /(?:列出|查看|显示|看看)(?:所有|全部|我的)?任务/,
      /(?:我|今天)?(?:还)?有(?:什么|哪些|多少)(?:任务|事|待办)/,
      /(?:todo|待办)(?:列表|清单)?/i,
    ],
    extractArgs: (input) => ({
      status: input.includes("完成")
        ? "done"
        : input.includes("待办")
          ? "todo"
          : undefined,
    }),
  },
  {
    intent: "get_today_plan",
    patterns: [
      /今天(?:的)?(?:计划|安排|日程|时间表)/,
      /(?:今天|今日)(?:还)?有(?:什么|哪些)(?:安排|计划|事)/,
      /(?:看看|查看|显示)今天/,
    ],
    extractArgs: () => ({
      date: new Date().toISOString().split("T")[0],
    }),
  },
  {
    intent: "reschedule_day",
    patterns: [
      /(?:重新|重)?(?:排|安排|规划)(?:一下)?(?:今天|明天)/,
      /(?:帮我|请)?(?:调整|优化)(?:一下)?(?:今天|明天)(?:的)?(?:计划|安排|日程)/,
    ],
    extractArgs: (input) => ({
      date: parseDate(input) ?? new Date().toISOString().split("T")[0],
    }),
  },
  {
    intent: "explain_schedule",
    patterns: [
      /为什么(?:这样|这么)?(?:安排|排)/,
      /(?:解释|说明)(?:一下)?(?:排程|安排|计划)/,
      /(?:今天|明天)?(?:的)?安排(?:是怎么|为什么)/,
    ],
    extractArgs: (input) => ({
      date: parseDate(input) ?? new Date().toISOString().split("T")[0],
    }),
  },
  {
    intent: "move_time_block",
    patterns: [
      /(?:把|将).+(?:移到|调到|改到|挪到)/,
      /(?:帮我|请)?(?:移动|调整).+(?:时间|时间块)/,
    ],
    extractArgs: (input) => ({
      titleKeyword: input.match(/(?:把|将)\s*(.+?)\s*(?:移到|调到|改到|挪到)/)?.[1]?.trim(),
      newTime: parseTimeOfDay(input),
      newDate: parseDate(input),
    }),
  },
  {
    intent: "create_time_block",
    patterns: [
      /(?:帮我|请)?(?:添加|创建|新建)(?:一个?)?时间块/,
      /(?:帮我|请)?(?:在|到).+(?:添加|加)(?:一个?)?(?:时间块|安排)/,
    ],
    extractArgs: (input) => ({
      title: extractTaskTitle(input),
      date: parseDate(input),
      timeOfDay: parseTimeOfDay(input),
      duration: parseDuration(input),
    }),
  },
  {
    intent: "update_task",
    patterns: [
      /(?:帮我|请)?(?:修改|更新|编辑|改一下).+任务/,
      /(?:把|将).+(?:改为|改成|修改为|更新为)/,
    ],
    extractArgs: (input) => ({
      titleKeyword: input.match(/(?:修改|更新|编辑)\s*(.+?)\s*(?:任务|的)/)?.[1]?.trim(),
    }),
  },
];

export class IntentParser {
  parse(input: string): ParsedIntent {
    const trimmed = input.trim();
    if (!trimmed) {
      return {
        intent: "unknown",
        confidence: 0,
        args: {},
        rawInput: input,
      };
    }

    for (const rule of RULES) {
      for (const pattern of rule.patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          return {
            intent: rule.intent,
            confidence: 0.8,
            args: rule.extractArgs(trimmed, match),
            rawInput: input,
          };
        }
      }
    }

    return {
      intent: "unknown",
      confidence: 0,
      args: {},
      rawInput: input,
    };
  }
}
