import { TimeBlockService } from "@/services/TimeBlockService";
import { TaskService } from "@/services/TaskService";
import type { TimeBlock } from "@/types/timeblock.types";
import type {
  HeartbeatSettings,
  HeartbeatEvaluation,
} from "@/types/heartbeat.types";

export class HeartbeatService {
  private timeBlockService: TimeBlockService;
  private taskService: TaskService;

  constructor(
    timeBlockService?: TimeBlockService,
    taskService?: TaskService
  ) {
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
    this.taskService = taskService ?? new TaskService();
  }

  // ─── 纯逻辑：综合评估（同步，不访问数据库） ─────────────────────────────────

  /**
   * 根据当日 TimeBlock 列表、当前时间和 Heartbeat 设置，返回当前应触发的事件集合。
   */
  evaluateNow(
    blocks: TimeBlock[],
    now: Date,
    settings: HeartbeatSettings
  ): HeartbeatEvaluation {
    return {
      currentFocusBlock: this.getCurrentFocus(blocks, now),
      upcomingReminderBlock: this.getUpcomingReminder(blocks, now, settings),
      startPromptBlock: this.getStartPrompt(blocks, now),
      pendingFeedbackBlock: this.getPendingFeedback(blocks, now),
    };
  }

  // ─── 纯逻辑：当前焦点 TimeBlock ──────────────────────────────────────────

  /**
   * 返回当前时间正在进行中的 TimeBlock。
   * - 时间范围：now >= start_time 且 now < end_time
   * - 状态：scheduled 或 in_progress
   * - 优先返回 in_progress；若均为 scheduled，返回 start_time 最早的
   * - 已软删除的块排除
   */
  getCurrentFocus(blocks: TimeBlock[], now: Date): TimeBlock | null {
    const nowStr = now.toISOString();

    const active = blocks.filter(
      (b) =>
        !b.deleted_at &&
        (b.status === "scheduled" || b.status === "in_progress") &&
        b.start_time <= nowStr &&
        b.end_time > nowStr
    );

    if (active.length === 0) return null;

    const inProgress = active.filter((b) => b.status === "in_progress");
    if (inProgress.length > 0) {
      return inProgress.sort((a, b) =>
        a.start_time.localeCompare(b.start_time)
      )[0];
    }

    return active.sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
  }

  // ─── 纯逻辑：开始前提醒 ────────────────────────────────────────────────────

  /**
   * 返回需要发出开始前提醒的 TimeBlock（每个块只提醒一次）。
   * - status = scheduled，start_time 尚未到
   * - 距离 start_time <= reminderBeforeMinutes 分钟
   * - reminder_sent_at 为空（防重复）
   * - 未软删除
   */
  getUpcomingReminder(
    blocks: TimeBlock[],
    now: Date,
    settings: HeartbeatSettings
  ): TimeBlock | null {
    const nowStr = now.toISOString();
    const windowEnd = new Date(
      now.getTime() + settings.reminderBeforeMinutes * 60 * 1000
    ).toISOString();

    const candidates = blocks.filter(
      (b) =>
        !b.deleted_at &&
        b.status === "scheduled" &&
        b.start_time > nowStr &&
        b.start_time <= windowEnd &&
        !b.reminder_sent_at
    );

    if (candidates.length === 0) return null;
    return candidates.sort((a, b) =>
      a.start_time.localeCompare(b.start_time)
    )[0];
  }

  // ─── 纯逻辑：开始提示 ──────────────────────────────────────────────────────

  /**
   * 返回需要发出开始提示的 TimeBlock（每个块只提示一次）。
   * - status = scheduled（尚未被用户切换为 in_progress）
   * - now >= start_time 且 now < end_time
   * - start_prompt_sent_at 为空（防重复）
   * - 未软删除
   */
  getStartPrompt(blocks: TimeBlock[], now: Date): TimeBlock | null {
    const nowStr = now.toISOString();

    const candidates = blocks.filter(
      (b) =>
        !b.deleted_at &&
        b.status === "scheduled" &&
        b.start_time <= nowStr &&
        b.end_time > nowStr &&
        !b.start_prompt_sent_at
    );

    if (candidates.length === 0) return null;
    return candidates.sort((a, b) =>
      a.start_time.localeCompare(b.start_time)
    )[0];
  }

  // ─── 纯逻辑：待反馈（结束后） ────────────────────────────────────────────

  /**
   * 返回需要弹出结束反馈的 TimeBlock（每个块只弹一次）。
   * - now >= end_time（时间块已结束）
   * - status 为 scheduled 或 in_progress（尚未完成反馈）
   * - end_prompt_sent_at 为空（防永久重复）
   * - feedback_snoozed_until 为空或已过（V3.7 P0-2：暂缓静默期内不再弹）
   * - 未软删除
   */
  getPendingFeedback(blocks: TimeBlock[], now: Date): TimeBlock | null {
    const nowStr = now.toISOString();

    const candidates = blocks.filter(
      (b) =>
        !b.deleted_at &&
        (b.status === "scheduled" || b.status === "in_progress") &&
        b.end_time <= nowStr &&
        !b.end_prompt_sent_at &&
        !(b.feedback_snoozed_until && b.feedback_snoozed_until > nowStr)
    );

    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => a.end_time.localeCompare(b.end_time))[0];
  }

  // ─── DB 操作：防重复标记 ──────────────────────────────────────────────────

  async markReminderSent(blockId: string): Promise<TimeBlock> {
    return this.timeBlockService.updateExecutionState(blockId, {
      reminder_sent_at: new Date().toISOString(),
    });
  }

  async markStartPromptSent(blockId: string): Promise<TimeBlock> {
    return this.timeBlockService.updateExecutionState(blockId, {
      start_prompt_sent_at: new Date().toISOString(),
    });
  }

  async markEndPromptSent(blockId: string): Promise<TimeBlock> {
    return this.timeBlockService.updateExecutionState(blockId, {
      end_prompt_sent_at: new Date().toISOString(),
    });
  }

  /**
   * V3.7 P0-2: 用户对结束反馈点「暂不处理」时调用。
   * 把 feedback_snoozed_until 写入 DB（默认 +10min），跨 session/页面切换后
   * 仍能在静默期内不重复弹窗。
   *
   * 注意：与 markEndPromptSent 的区别——后者一次性永久标记，前者临时暂缓。
   */
  async snoozeFeedback(
    blockId: string,
    options: { minutes?: number } = {}
  ): Promise<TimeBlock> {
    const minutes = options.minutes ?? 10;
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    return this.timeBlockService.updateExecutionState(blockId, {
      feedback_snoozed_until: until,
    });
  }

  // ─── DB 操作：状态转换（含 Task 联动） ───────────────────────────────────

  /**
   * 用户点击"开始"：TimeBlock → in_progress，记录 started_at。
   * 如果绑定 Task，Task 状态 → in_progress。
   */
  async startBlock(blockId: string): Promise<void> {
    const now = new Date();
    const block = await this.timeBlockService.updateExecutionState(blockId, {
      status: "in_progress",
      started_at: now.toISOString(),
    });

    if (block.task_id) {
      await this.taskService.updateTaskStatus(block.task_id, "in_progress");
    }
  }

  /**
   * 用户选择"Done"：TimeBlock → done，记录 completed_at。
   * Task 联动：
   * - 如果还有未来活跃 TimeBlock → Task 保持 scheduled
   * - 否则 → Task → done
   */
  async completeBlock(blockId: string, feedbackNote?: string): Promise<void> {
    const now = new Date();
    const block = await this.timeBlockService.updateExecutionState(blockId, {
      status: "done",
      completed_at: now.toISOString(),
      ...(feedbackNote !== undefined ? { feedback_note: feedbackNote } : {}),
    });

    if (block.task_id) {
      const futureCount = await this.taskService.getFutureActiveBlocksCount(
        block.task_id,
        now
      );
      await this.taskService.updateTaskStatus(
        block.task_id,
        futureCount > 0 ? "scheduled" : "done"
      );
    }
  }

  /**
   * 用户选择"Skip"：TimeBlock → skipped，记录 skipped_at。
   * Task 联动：
   * - 如果还有未来活跃 TimeBlock → Task 保持 scheduled
   * - 否则 → Task → todo（任务未完成，需重新安排）
   */
  async skipBlock(blockId: string, feedbackNote?: string): Promise<void> {
    const now = new Date();
    const block = await this.timeBlockService.updateExecutionState(blockId, {
      status: "skipped",
      skipped_at: now.toISOString(),
      ...(feedbackNote !== undefined ? { feedback_note: feedbackNote } : {}),
    });

    if (block.task_id) {
      const futureCount = await this.taskService.getFutureActiveBlocksCount(
        block.task_id,
        now
      );
      await this.taskService.updateTaskStatus(
        block.task_id,
        futureCount > 0 ? "scheduled" : "todo"
      );
    }
  }

  /**
   * 用户选择"Delay"：TimeBlock → delayed，记录 delayed_at。
   * 不自动重排，不新建 TimeBlock，只提示用户后续可重新安排。
   * Task 联动规则同 Skip。
   */
  async delayBlock(blockId: string, feedbackNote?: string): Promise<void> {
    const now = new Date();
    const block = await this.timeBlockService.updateExecutionState(blockId, {
      status: "delayed",
      delayed_at: now.toISOString(),
      ...(feedbackNote !== undefined ? { feedback_note: feedbackNote } : {}),
    });

    if (block.task_id) {
      const futureCount = await this.taskService.getFutureActiveBlocksCount(
        block.task_id,
        now
      );
      await this.taskService.updateTaskStatus(
        block.task_id,
        futureCount > 0 ? "scheduled" : "todo"
      );
    }
  }
}
