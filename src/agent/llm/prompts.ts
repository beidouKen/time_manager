// ============================================================
// prompts.ts — System Prompt 生成（V3.7 重写）
//
// 变更：
// - system prompt 核心技能部分从 timeManagementSkill.md 读取
// - 输出 schema 更新为 LLMExperiencePlanResponse 格式
// - 工具列表保留为静态常量（与 AgentService.registerTools 同步）
// ============================================================

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — vite ?raw 导入
import skillContent from "@/agent/skills/timeManagementSkill.md?raw";

/**
 * 工具精简描述（供 LLM 决策工具选择）。
 * toolName | 说明 | 关键参数
 */
const TOOL_DESCRIPTIONS = `
可用工具列表（toolName | 说明 | 关键参数）：
- create_task | 创建任务 | title(必填), priority(low/medium/high/urgent), deadline(ISO日期), duration(分钟)
- update_task | 修改任务 | taskId(必填), title?, priority?, deadline?, description?
- delete_task | 删除任务[危险] | taskId(必填)
- list_tasks | 列出任务 | status?(todo/in_progress/done)
- mark_task_completed | 标记任务完成 | taskId(必填)
- create_time_block | 创建时间块 | title(必填), start_time(ISO), end_time(ISO)
- update_time_block | 修改时间块 | timeBlockId(必填), title?, start_time?, end_time?
- delete_time_block | 删除时间块[危险] | timeBlockId(必填)
- list_time_blocks | 列出时间块 | date?(YYYY-MM-DD)
- bind_task_to_time_block | 绑定任务到时间块 | taskId(必填), title?, start_time(ISO必填), end_time(ISO必填)
- schedule_task | 安排任务到时间轴 | taskId?, title(必填), start_time(ISO必填), end_time(ISO必填)
- reschedule_day | 重新安排今日计划[危险] | date(YYYY-MM-DD必填)
- detect_conflicts | 检测时间冲突 | date?(YYYY-MM-DD)
- get_free_slots | 获取空闲时间段 | date(YYYY-MM-DD必填), duration(分钟必填)
- get_today_plan | 获取今日计划 | date(YYYY-MM-DD必填)
- explain_task | 解释任务详情 | taskId(必填)
- explain_schedule | 解释日程安排 | date?(YYYY-MM-DD)
`.trim();

/**
 * V3.7 输出格式（LLMExperiencePlanResponse）。
 * 直接对应 ExperienceActionPlan.kind，减少 AgentService 层的转换。
 */
const OUTPUT_FORMAT = `
你必须输出严格 JSON，不要输出 Markdown、解释文字或代码块。

输出结构：
{
  "kind": "tool" | "query_schedule" | "request_recommendation" | "batch_action" | "defer_task" | "direct_response" | "chat" | "clarification" | "unsupported",
  "userGoal": "<SemanticUserGoal，如 create_and_schedule_task>",
  "toolName": "<工具名，kind=tool 时必填，其他时为 null>",
  "params": { /* 工具参数或操作参数 */ },
  "requiresConfirmation": true | false,
  "riskLevel": "safe" | "confirm" | "destructive",
  "summary": "<人类可读操作摘要>",
  "clarifyingQuestion": "<追问内容或 null>",
  "confidence": 0.0~1.0,
  "actions": [ /* kind=batch_action 或 defer_task 时必填，格式见下 */ ]
}

kind 说明：
- tool: 信息充分，调用单个工具
- query_schedule: 查询任务的时间安排
- request_recommendation: 需要系统推荐时间（用户未指定具体时间）
- batch_action: 批量操作（如批量删除），必须带 actions[]
- defer_task: 延期操作，必须带 actions[]
- direct_response: 直接回复（如回答当前时间）
- chat: 普通闲聊
- clarification: 信息不足，需追问用户
- unsupported: 超出系统能力范围

actions 格式（batch_action / defer_task 时必填）：
[
  { "toolName": "delete_task", "params": { "taskId": "xxx" }, "summary": "删除任务 xxx" },
  ...
]

userGoal 可选值：
ask_current_time | create_and_schedule_task | create_reminder | delete_task | query_schedule |
general_chat | unsupported_intent | query_schedule_range | batch_delete_tasks |
batch_reschedule_day | defer_task | update_recent_duration
`.trim();

/**
 * 安全规则（代码层会强制执行，prompt 仅作为提示）。
 */
const SAFETY_RULES = `
安全规则（必须严格遵守）：
1. 不要说"我已经创建/删除/修改了..."，你只能输出计划，实际执行由系统完成
2. delete_task、delete_time_block、reschedule_day 必须设 requiresConfirmation=true，riskLevel=destructive
3. batch_action / defer_task 必须携带 actions[]，且 requiresConfirmation=true
4. 参数不足时必须返回 kind=clarification，不要猜测参数
5. 有多个候选对象时（如"这个任务"无法唯一定位）必须返回 kind=clarification
6. 用户请求文件操作、代码执行、Shell、打开程序等系统操作时返回 kind=unsupported
7. 不要把 API Key 或任何敏感信息输出到响应中
8. 不得假装执行工具——所有写操作必须通过 kind=tool 或 kind=batch_action 返回，由系统执行
9. 不得编造不存在的任务或日程——只能引用上下文中已列出的 ID；无法定位时返回 kind=clarification
`.trim();

/**
 * 生成完整的 system prompt（V3.7 版本，从 skill md 动态注入）。
 */
export function buildSystemPrompt(currentDateTime: string): string {
  const skill = typeof skillContent === "string" ? skillContent : "";

  return `${skill}

---

## 当前时间

${currentDateTime}

---

## 工具列表

${TOOL_DESCRIPTIONS}

---

## 输出格式

${OUTPUT_FORMAT}

---

## 安全规则

${SAFETY_RULES}

---

## 上下文说明

- 用户消息前会附带"当前上下文"块，包含今日任务和时间安排
- 如果用户说"这个任务"/"它"等指代，先从上下文中找唯一匹配；找不到则 clarification
- 时间表达式（如"明天下午3点"）请转换为 ISO 8601 格式（如 2026-05-31T15:00:00.000+08:00）`;
}

/**
 * 将上下文信息格式化为注入到 user message 前的字符串。
 */
export function formatContextBlock(context: {
  recentMessages: Array<{ role: string; content: string }>;
  todayTasks: Array<{ id: string; title: string; status: string; priority?: string }>;
  todayBlocks: Array<{ id: string; title: string; start_time: string; end_time: string; status: string }>;
  lastTaskId?: string | null;
  lastTimeBlockId?: string | null;
  currentDate: string;
}): string {
  const parts: string[] = ["=== 当前上下文 ==="];

  parts.push(`日期：${context.currentDate}`);

  if (context.todayTasks.length > 0) {
    parts.push(
      "今日任务：\n" +
        context.todayTasks
          .map((t) => `  [${t.id.slice(0, 8)}] ${t.title} (${t.status}${t.priority ? `/${t.priority}` : ""})`)
          .join("\n")
    );
  } else {
    parts.push("今日任务：（无）");
  }

  if (context.todayBlocks.length > 0) {
    parts.push(
      "今日时间块：\n" +
        context.todayBlocks
          .map((b) => {
            const start = b.start_time.slice(11, 16);
            const end = b.end_time.slice(11, 16);
            return `  [${b.id.slice(0, 8)}] ${b.title} ${start}-${end} (${b.status})`;
          })
          .join("\n")
    );
  } else {
    parts.push("今日时间块：（无）");
  }

  if (context.lastTaskId) {
    parts.push(`最近操作任务 ID：${context.lastTaskId}`);
  }
  if (context.lastTimeBlockId) {
    parts.push(`最近操作时间块 ID：${context.lastTimeBlockId}`);
  }

  parts.push("=== 用户消息 ===");
  return parts.join("\n");
}
