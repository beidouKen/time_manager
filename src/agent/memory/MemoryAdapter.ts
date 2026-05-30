// ============================================================
// MemoryAdapter.ts — Agent 行为记录接口
//
// 职责：记录用户历史任务完成情况与排程行为，供 V5 建议型 Agent 使用。
// 本 Phase（V3/V4）仅建立骨架；V5 阶段 MockMemoryAdapter 填入语义。
// 不接真实数据库，禁止引入任何外部 fetch / DB 连接。
// ============================================================

export interface BehaviorRecord {
  /** 事件类型 */
  type: "task_scheduled" | "task_completed" | "task_deferred" | "task_deleted";
  /** 任务 ID */
  taskId: string;
  /** 任务标题 */
  title: string;
  /** 任务类别（可选） */
  category?: string;
  /** 预计时长（分钟） */
  estimatedMinutes?: number;
  /** 实际时长（分钟，完成时填充） */
  actualMinutes?: number;
  /** 时间戳 */
  timestamp: string;
}

export interface RecentBehaviorSummary {
  /** 过去 N 天内的行为记录 */
  records: BehaviorRecord[];
  /** 各类别平均完成率（0-1），key = category */
  completionRateByCategory: Record<string, number>;
  /** 过去 N 天内平均每日 block 数 */
  avgBlocksPerDay: number;
}

export interface MemoryAdapter {
  /**
   * 记录一次排程事件（在 ToolRouter execute schedule_task 成功后调用）。
   * 不在 Tool 层内部调用，保持 Tool 纯净。
   */
  recordSchedule(record: Omit<BehaviorRecord, "type" | "timestamp">): Promise<void>;

  /**
   * 记录一次任务完成事件（在 ToolRouter execute mark_task_completed 成功后调用）。
   */
  recordTaskCompletion(
    record: Omit<BehaviorRecord, "type" | "timestamp"> & { actualMinutes?: number }
  ): Promise<void>;

  /**
   * 获取最近 windowDays 天的行为摘要。
   */
  getRecentBehavior(windowDays: number): Promise<RecentBehaviorSummary>;
}
