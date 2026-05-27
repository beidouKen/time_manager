// ============================================================
// contextBuilder.ts — 轻量上下文构造器
//
// 职责：为 LLMPlanner 提供结构化的上下文信息，包括：
// 1. 最近 N 条 Chat 消息（用于指代消解）
// 2. 今日任务摘要
// 3. 今日 TimeBlock 摘要
// 4. 最近一次操作的关联 ID
// 5. 当前日期时间
//
// 设计约束：
// - 不塞入全部历史数据，只取最小必要上下文
// - 总 token 估算控制在约 500-800 范围内
// ============================================================

import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";

export interface RecentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMContext {
  recentMessages: Array<{ role: string; content: string }>;
  todayTasks: Array<{
    id: string;
    title: string;
    status: string;
    priority?: string;
  }>;
  todayBlocks: Array<{
    id: string;
    title: string;
    start_time: string;
    end_time: string;
    status: string;
  }>;
  lastTaskId: string | null;
  lastTimeBlockId: string | null;
  currentDate: string;
}

const RECENT_MESSAGES_LIMIT = 6;

export class ContextBuilder {
  private taskService: TaskService;
  private timeBlockService: TimeBlockService;

  constructor(taskService?: TaskService, timeBlockService?: TimeBlockService) {
    this.taskService = taskService ?? new TaskService();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

  /**
   * 构造 LLM 上下文。
   *
   * @param recentMessages  chatStore 中最近的消息（调用方传入，避免直接依赖 store）
   * @param lastTaskId      AgentService 追踪的最近操作任务 ID
   * @param lastTimeBlockId AgentService 追踪的最近操作时间块 ID
   */
  async build(
    recentMessages: RecentMessage[],
    lastTaskId: string | null,
    lastTimeBlockId: string | null
  ): Promise<LLMContext> {
    const today = new Date();
    const currentDate = today.toISOString().split("T")[0];

    // 并行获取今日任务和时间块（降低延迟）
    const [tasks, blocks] = await Promise.all([
      this.fetchTodayTasks(),
      this.fetchTodayBlocks(today),
    ]);

    return {
      recentMessages: recentMessages.slice(-RECENT_MESSAGES_LIMIT).map((m) => ({
        role: m.role,
        // 截断过长消息，避免 token 爆炸
        content: m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content,
      })),
      todayTasks: tasks,
      todayBlocks: blocks,
      lastTaskId,
      lastTimeBlockId,
      currentDate,
    };
  }

  private async fetchTodayTasks(): Promise<LLMContext["todayTasks"]> {
    try {
      const tasks = await this.taskService.getTasks({ excludeDeleted: true });
      // 只返回未完成的任务，控制 token；最多 20 条
      return tasks
        .filter((t) => t.status !== "done")
        .slice(0, 20)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority ?? undefined,
        }));
    } catch {
      return [];
    }
  }

  private async fetchTodayBlocks(today: Date): Promise<LLMContext["todayBlocks"]> {
    try {
      const blocks = await this.timeBlockService.getBlocksForDate(today);
      return blocks
        .filter((b) => !b.deleted_at)
        .map((b) => ({
          id: b.id,
          title: b.title,
          start_time: b.start_time,
          end_time: b.end_time,
          status: b.status,
        }));
    } catch {
      return [];
    }
  }
}
