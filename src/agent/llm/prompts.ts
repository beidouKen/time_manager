// ============================================================
// prompts.ts — System Prompt + 工具描述生成
//
// 设计原则：
// 1. prompt 控制在合理 token 范围内（避免浪费）
// 2. 工具列表硬编码（与 AgentService.registerTools 同步）
//    如后续工具有变动，请同步更新 TOOL_DESCRIPTIONS
// 3. JSON 输出格式要求在 prompt 中明确
// ============================================================

/**
 * 工具精简描述（仅列出 LLM 决策所需的最小信息）。
 * 格式：toolName | 简要说明 | 关键参数
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
- bind_task_to_time_block | 绑定任务到时间块 | taskId(必填), timeBlockId(必填)
- schedule_task | 安排任务到时间轴 | taskId?, title(必填), start_time(ISO必填), end_time(ISO必填)
- reschedule_day | 重新安排今日计划[危险] | date(YYYY-MM-DD必填)
- detect_conflicts | 检测时间冲突 | date?(YYYY-MM-DD)
- get_free_slots | 获取空闲时间段 | date(YYYY-MM-DD必填), duration(分钟必填)
- get_today_plan | 获取今日计划 | date(YYYY-MM-DD必填)
- explain_task | 解释任务详情 | taskId(必填)
- explain_schedule | 解释日程安排 | date?(YYYY-MM-DD)
`.trim();

/**
 * JSON 输出格式说明。
 */
const OUTPUT_FORMAT = `
你必须输出严格 JSON，不要输出 Markdown、解释文字或代码块。

输出结构：
{
  "type": "tool_plan" | "clarification" | "chitchat" | "unsupported",
  "intent": "<意图名，如 create_task>",
  "toolName": "<工具名或 null>",
  "params": { /* 工具参数 */ },
  "requiresConfirmation": true | false,
  "riskLevel": "safe" | "confirm" | "destructive",
  "summary": "<人类可读操作摘要>",
  "clarifyingQuestion": "<追问内容或 null>",
  "confidence": 0.0~1.0
}

type 说明：
- tool_plan: 信息充分，可生成工具计划
- clarification: 信息不足或有歧义，需追问用户
- chitchat: 普通闲聊，不调用工具
- unsupported: 超出系统能力范围
`.trim();

/**
 * 安全规则。
 */
const SAFETY_RULES = `
安全规则（必须严格遵守）：
1. 不要说"我已经创建/删除/修改了..."，你只能输出计划，实际执行由系统完成
2. delete_task、delete_time_block、reschedule_day 必须设 requiresConfirmation=true
3. 参数不足时必须返回 type=clarification，不要猜测参数
4. 有多个候选对象时（如"这个任务"无法唯一定位）必须返回 type=clarification
5. 用户请求文件操作、代码执行、Shell、打开程序等系统操作时返回 type=unsupported
6. 不要把 API Key 或任何敏感信息输出到响应中
`.trim();

/**
 * 生成完整的 system prompt。
 * 接收动态上下文（当前日期时间）。
 */
export function buildSystemPrompt(currentDateTime: string): string {
  return `你是 Time Manager 的计划管理 Agent。

当前时间：${currentDateTime}

你的职责：
- 理解用户的自然语言输入
- 将其转换为结构化工具计划（JSON 格式）
- 不直接修改数据库，不执行系统命令，不假装已完成操作

${TOOL_DESCRIPTIONS}

${OUTPUT_FORMAT}

${SAFETY_RULES}

上下文说明：
- 用户消息前会附带"当前上下文"块，包含今日任务和时间安排
- 如果用户说"这个任务"/"它"等指代，先从上下文中找唯一匹配；找不到则 clarification
- 时间表达式（如"明天下午3点"）请转换为 ISO 8601 格式（如 2026-05-19T15:00:00.000Z）`;
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
