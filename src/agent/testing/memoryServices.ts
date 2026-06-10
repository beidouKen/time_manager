// ============================================================
// memoryServices.ts — 公共进程内 Service/Repository 实现
//
// 抽取自 agent_router_gold.test.ts 和 v3_6_1_pipeline.test.ts。
// 仅供测试使用，不引入任何真实数据库或外部依赖。
//
// 使用方式：
//   import { MemoryTaskService, MemoryTimeBlockService, ... } from "@/agent/testing/memoryServices";
// ============================================================

import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";
import { ScheduleService } from "@/services/ScheduleService";
import type { IConfirmationRepository } from "@/repositories/interfaces/IConfirmationRepository";
import type { IConversationRepository } from "@/repositories/interfaces/IConversationRepository";
import type { ITurnRepository } from "@/repositories/interfaces/ITurnRepository";
import type { ISemanticEventRepository } from "@/repositories/interfaces/ISemanticEventRepository";
import type { IActiveContextRepository } from "@/repositories/interfaces/IActiveContextRepository";
import type { ITraceStepRepository } from "@/repositories/interfaces/ITraceStepRepository";
import type { Task, CreateTaskInput, TaskFilter } from "@/types/task.types";
import type { TimeBlock, CreateTimeBlockInput } from "@/types/timeblock.types";
import type {
  Conversation,
  ConversationMessage,
  CreateConversationInput,
  CreateMessageInput,
  PendingConfirmation,
  CreateConfirmationInput,
  ConfirmationStatus,
  Turn,
  CreateTurnInput,
  TurnStatus,
  SemanticEvent,
  CreateSemanticEventInput,
  ActiveContext,
  ActiveContextStatus,
  CreateActiveContextInput,
  UpdateActiveContextInput,
  AgentTraceStep,
  CreateTraceStepInput,
} from "@/types/agent.types";

// ─── MemoryTaskService ────────────────────────────────────────────────────────

export class MemoryTaskService extends TaskService {
  tasks: Task[] = [];
  private seq = 1;

  override async getTasks(filter?: TaskFilter): Promise<Task[]> {
    let tasks = this.tasks;
    if (filter?.excludeDeleted) {
      tasks = tasks.filter((t) => !t.deleted_at);
    }
    if (!filter?.includeArchived) {
      tasks = tasks.filter((t) => !t.archived_at);
    }
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter((t) => statuses.includes(t.status));
    }
    return tasks;
  }

  override async getTaskById(id: string): Promise<Task | null> {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  override async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${this.seq++}`,
      title: input.title,
      description: input.description,
      deadline: input.deadline,
      estimated_duration_minutes: input.estimated_duration_minutes,
      priority: input.priority ?? "medium",
      status: "todo",
      category: input.category,
      is_flexible: input.is_flexible ?? true,
      can_split: input.can_split ?? false,
      created_at: now,
      updated_at: now,
    };
    this.tasks.unshift(task);
    return task;
  }

  override async deleteTask(id: string): Promise<void> {
    const now = new Date().toISOString();
    this.tasks = this.tasks.map((t) =>
      t.id === id ? { ...t, deleted_at: now, updated_at: now } : t
    );
  }

  override async updateTask(
    id: string,
    input: import("@/types/task.types").UpdateTaskInput
  ): Promise<Task> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new Error("任务不存在");
    const now = new Date().toISOString();
    const updated: Task = { ...task, ...(input as Partial<Task>), updated_at: now };
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  override async updateTaskStatus(
    id: string,
    status: import("@/types/task.types").TaskStatus
  ): Promise<Task> {
    const existing = await this.getTaskById(id);
    if (!existing) throw new Error("task not found");
    const now = new Date().toISOString();
    const patch: Partial<Task> = {
      status,
      updated_at: now,
      ...(status === "done" ? { completed_at: existing.completed_at ?? now } : {}),
      ...(status !== "done" && status !== "archived" ? { completed_at: undefined } : {}),
      ...(status !== "archived" ? { archived_at: undefined } : {}),
      ...(status !== "deferred" ? { deferred_until: undefined } : {}),
    };
    const updated: Task = { ...existing, ...patch };
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  override async completeTask(
    id: string,
    opts: { completedAt?: string } = {}
  ): Promise<Task> {
    const existing = await this.getTaskById(id);
    if (!existing || existing.deleted_at) throw new Error("task not found");
    if (existing.status === "archived") throw new Error("archived task cannot be completed");
    return this.updateTask(id, {
      status: "done",
      completed_at: opts.completedAt ?? new Date().toISOString(),
      archived_at: null,
      deferred_until: null,
    });
  }

  override async skipTaskToday(id: string): Promise<Task> {
    const existing = await this.getTaskById(id);
    if (!existing || existing.deleted_at) throw new Error("task not found");
    return this.updateTask(id, {
      status: "todo",
      deferred_until: null,
    });
  }

  override async deferTask(id: string, until?: string): Promise<Task> {
    const existing = await this.getTaskById(id);
    if (!existing || existing.deleted_at) throw new Error("task not found");
    if (existing.status === "archived") throw new Error("archived task cannot be deferred");
    return this.updateTask(id, {
      status: "deferred",
      deferred_until: until ?? null,
      completed_at: null,
      archived_at: null,
    });
  }

  override async reopenTask(id: string): Promise<Task> {
    const existing = await this.getTaskById(id);
    if (!existing || existing.deleted_at) throw new Error("task not found");
    if (!["done", "cancelled", "deferred", "archived"].includes(existing.status)) {
      return existing;
    }
    return this.updateTask(id, {
      status: "todo",
      archived_at: null,
      completed_at: null,
      deferred_until: null,
    });
  }

  override async archiveTask(
    id: string,
    opts: { archivedAt?: string } = {}
  ): Promise<Task> {
    const existing = await this.getTaskById(id);
    if (!existing || existing.deleted_at) throw new Error("task not found");
    if (existing.status !== "done" && existing.status !== "cancelled") {
      throw new Error("only done or cancelled tasks can be archived");
    }
    const now = new Date().toISOString();
    const updated: Task = {
      ...existing,
      status: "archived",
      archived_at: opts.archivedAt ?? now,
      updated_at: now,
    };
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  override async unarchiveTask(id: string): Promise<Task> {
    const existing = await this.getTaskById(id);
    if (!existing || existing.deleted_at) throw new Error("task not found");
    if (existing.status !== "archived" && !existing.archived_at) {
      throw new Error("task is not archived");
    }
    return this.updateTask(id, {
      status: existing.completed_at ? "done" : "todo",
      archived_at: null,
    });
  }

  override async batchDeleteTasks(ids: string[]): Promise<{ deletedIds: string[] }> {
    if (ids.length === 0) throw new Error("batch delete requires at least one task");
    const deletedIds: string[] = [];
    for (const id of ids) {
      const existing = await this.getTaskById(id);
      if (!existing || existing.deleted_at) continue;
      await this.deleteTask(id);
      deletedIds.push(id);
    }
    return { deletedIds };
  }

  override async autoArchiveStaleDone(
    thresholdDays = 7,
    now: Date = new Date()
  ): Promise<{ archived: Task[] }> {
    const cutoff = new Date(now.getTime() - thresholdDays * 24 * 60 * 60 * 1000);
    const stale = this.tasks.filter(
      (task) =>
        !task.deleted_at &&
        !task.archived_at &&
        task.status === "done" &&
        task.completed_at !== undefined &&
        new Date(task.completed_at).getTime() < cutoff.getTime()
    );
    const archived: Task[] = [];
    for (const task of stale) {
      archived.push(await this.archiveTask(task.id));
    }
    return { archived };
  }

  markScheduled(taskId: string): void {
    this.tasks = this.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status: "scheduled" as const,
            completed_at: undefined,
            archived_at: undefined,
            deferred_until: undefined,
          }
        : t
    );
  }
}

// ─── MemoryTimeBlockService ───────────────────────────────────────────────────

export class MemoryTimeBlockService extends TimeBlockService {
  blocks: TimeBlock[] = [];
  private seq = 1;

  override async getBlocksByTaskId(taskId: string): Promise<TimeBlock[]> {
    return this.blocks.filter((b) => b.task_id === taskId);
  }

  override async getBlocksForDate(date: Date): Promise<TimeBlock[]> {
    const key = date.toISOString().slice(0, 10);
    return this.blocks.filter((b) => b.start_time.slice(0, 10) === key);
  }

  /** V4: 多日查询支持 */
  async getBlocksForDateRange(from: Date, to: Date): Promise<TimeBlock[]> {
    const fromKey = from.toISOString().slice(0, 10);
    const toKey = to.toISOString().slice(0, 10);
    return this.blocks.filter((b) => {
      const dayKey = b.start_time.slice(0, 10);
      return dayKey >= fromKey && dayKey <= toKey && !b.deleted_at;
    });
  }

  override async getBlockById(id: string): Promise<TimeBlock | null> {
    return this.blocks.find((b) => b.id === id) ?? null;
  }

  override async batchCancelByTaskId(
    taskId: string,
    opts: { onlyFuture?: boolean } = {}
  ): Promise<number> {
    const now = new Date().toISOString();
    let cancelledCount = 0;
    this.blocks = this.blocks.map((block) => {
      if (
        block.task_id !== taskId ||
        block.deleted_at ||
        block.status !== "scheduled" ||
        (opts.onlyFuture && block.start_time <= now)
      ) {
        return block;
      }
      cancelledCount++;
      return {
        ...block,
        status: "cancelled" as const,
        updated_at: now,
      };
    });
    return cancelledCount;
  }

  override async createTimeBlock(input: CreateTimeBlockInput): Promise<TimeBlock> {
    const now = new Date().toISOString();
    const block: TimeBlock = {
      id: `block-${this.seq++}`,
      task_id: input.task_id,
      title: input.title,
      start_time: input.start_time,
      end_time: input.end_time,
      type: input.type ?? "task",
      status: "scheduled",
      is_locked: input.is_locked ?? false,
      source: input.source ?? "system",
      created_at: now,
      updated_at: now,
    };
    this.blocks.push(block);
    return block;
  }
}

// ─── MemoryScheduleService ────────────────────────────────────────────────────

export class MemoryScheduleService extends ScheduleService {
  constructor(
    private tasksMem: MemoryTaskService,
    private blocksMem: MemoryTimeBlockService
  ) {
    super();
  }

  override async checkConflicts(
    startTime: string,
    endTime: string,
    excludeId?: string
  ): Promise<import("@/lib/conflictDetector").ConflictResult> {
    const blocks = this.blocksMem.blocks.filter(
      (b) =>
        !b.deleted_at &&
        b.status !== "cancelled" &&
        b.status !== "skipped" &&
        b.status !== "done" &&
        b.id !== excludeId
    );
    const conflictingBlocks = blocks.filter(
      (b) => b.start_time < endTime && b.end_time > startTime
    );
    return { hasConflict: conflictingBlocks.length > 0, conflictingBlocks };
  }

  override async scheduleTaskToTimeBlock(input: {
    taskId: string;
    title: string;
    startTime: string;
    endTime: string;
    initialStatus?: "scheduled" | "done";
  }): Promise<TimeBlock> {
    const task = await this.tasksMem.getTaskById(input.taskId);
    if (!task) throw new Error("任务不存在");
    const block = await this.blocksMem.createTimeBlock({
      task_id: input.taskId,
      title: input.title,
      start_time: input.startTime,
      end_time: input.endTime,
      type: "task",
      source: "system",
    });
    // V3.8+: 补记模式 → 将任务标记为已完成
    const newStatus = input.initialStatus === "done" ? "done" : "scheduled";
    await this.tasksMem.updateTask(input.taskId, {
      status: newStatus,
      completed_at: input.initialStatus === "done" ? new Date().toISOString() : null,
      archived_at: null,
      deferred_until: null,
    });
    return block;
  }
}

// ─── MemoryConfirmationRepository ────────────────────────────────────────────

export class MemoryConfirmationRepository implements IConfirmationRepository {
  records: PendingConfirmation[] = [];
  private seq = 1;

  async create(data: CreateConfirmationInput): Promise<PendingConfirmation> {
    const record: PendingConfirmation = {
      id: `conf-${this.seq++}`,
      action_type: data.action_type,
      tool_name: data.tool_name,
      tool_args_json: data.tool_args_json,
      description: data.description,
      risk_level: data.risk_level ?? "medium",
      status: "pending",
      created_at: new Date().toISOString(),
      expires_at: data.expires_at,
      // C2/G11: 新绑定字段
      conversation_id: data.conversation_id,
      turn_id: data.turn_id,
      message_id: data.message_id,
      proposal_id: data.proposal_id,
      related_task_id: data.related_task_id,
      related_time_block_id: data.related_time_block_id,
      metadata_json: data.metadata_json,
    };
    this.records.push(record);
    return record;
  }

  async findById(id: string): Promise<PendingConfirmation | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }

  async findPending(): Promise<PendingConfirmation[]> {
    return this.records.filter((r) => r.status === "pending");
  }

  async updateStatus(id: string, status: ConfirmationStatus): Promise<PendingConfirmation> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error("confirmation not found");
    record.status = status;
    return record;
  }

  async expireOld(_beforeDate: string): Promise<number> {
    return 0;
  }

  async invalidateByConversation(conversationId: string): Promise<number> {
    let count = 0;
    this.records = this.records.map((r) => {
      if (r.conversation_id === conversationId && r.status === "pending") {
        count++;
        return { ...r, status: "invalidated" as ConfirmationStatus };
      }
      return r;
    });
    return count;
  }

  async invalidateByRelatedTask(taskId: string): Promise<number> {
    let count = 0;
    this.records = this.records.map((r) => {
      if (r.related_task_id === taskId && r.status === "pending") {
        count++;
        return { ...r, status: "invalidated" as ConfirmationStatus };
      }
      return r;
    });
    return count;
  }
}

// ─── MemoryConversationRepository ────────────────────────────────────────────

export class MemoryConversationRepository implements IConversationRepository {
  messages: ConversationMessage[] = [];
  conversations: Conversation[] = [];
  private msgSeq = 1;
  private convSeq = 1;

  // ── message CRUD ──────────────────────────────────────────────────────────

  async create(data: CreateMessageInput): Promise<ConversationMessage> {
    const now = new Date().toISOString();
    const msg: ConversationMessage = {
      id: data.id ?? `msg-${this.msgSeq++}`,
      conversation_id: data.conversation_id ?? "default",
      turn_id: data.turn_id,
      role: data.role,
      content: data.content,
      metadata_json: data.metadata_json,
      created_at: now,
    };
    this.messages.push(msg);
    return msg;
  }

  async findRecent(limit: number, conversationId?: string): Promise<ConversationMessage[]> {
    if (limit <= 0) return [];
    const filtered = this.messages.filter(
      (m) =>
        !m.deleted_at &&
        (conversationId == null || m.conversation_id === conversationId),
    );
    return filtered.slice(-limit);
  }

  async findAll(): Promise<ConversationMessage[]> {
    return this.messages.filter((m) => !m.deleted_at);
  }

  async deleteAll(): Promise<void> {
    this.messages = [];
  }

  async updateMetadata(id: string, metadataJson: string): Promise<boolean> {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    this.messages[idx] = { ...this.messages[idx], metadata_json: metadataJson };
    return true;
  }

  // ── conversation CRUD ────────────────────────────────────────────────────

  async createConversation(data: CreateConversationInput): Promise<Conversation> {
    const now = new Date().toISOString();
    const conv: Conversation = {
      id: data.id ?? `conv-${this.convSeq++}`,
      title: data.title,
      status: "active",
      created_at: now,
      updated_at: now,
    };
    this.conversations.push(conv);
    return conv;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return this.conversations.find((c) => c.id === id) ?? null;
  }

  async listConversations(filter?: { status?: string }): Promise<Conversation[]> {
    if (filter?.status) {
      return this.conversations.filter((c) => c.status === filter.status);
    }
    return [...this.conversations];
  }

  async softDeleteConversation(id: string): Promise<{ conversation: number; messages: number }> {
    const now = new Date().toISOString();
    const idx = this.conversations.findIndex((c) => c.id === id && !c.deleted_at);
    let convCount = 0;
    if (idx >= 0) {
      this.conversations[idx] = {
        ...this.conversations[idx],
        status: "deleted",
        deleted_at: now,
        updated_at: now,
      };
      convCount = 1;
    }
    let msgCount = 0;
    this.messages = this.messages.map((m) => {
      if (m.conversation_id === id && !m.deleted_at) {
        msgCount++;
        return { ...m, deleted_at: now };
      }
      return m;
    });
    return { conversation: convCount, messages: msgCount };
  }

  async ensureDefaultConversation(): Promise<Conversation> {
    const active = this.conversations.find(
      (c) => c.status === "active" && c.id !== "legacy-default",
    );
    if (active) return active;
    return this.createConversation({ title: "default" });
  }

  /** C4 测试辅助：软删除单条消息（设置 deleted_at），模拟 DB 软删除行为 */
  async softDeleteMessage(id: string): Promise<void> {
    const now = new Date().toISOString();
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx >= 0) {
      this.messages[idx] = { ...this.messages[idx], deleted_at: now };
    }
  }
}

// ─── MemoryTurnRepository ─────────────────────────────────────────────────────

export class MemoryTurnRepository implements ITurnRepository {
  turns: Turn[] = [];
  private seq = 1;

  async create(data: CreateTurnInput): Promise<Turn> {
    const now = new Date().toISOString();
    const turn: Turn = {
      id: data.id ?? `turn-${this.seq++}`,
      conversation_id: data.conversation_id,
      user_message_id: data.user_message_id,
      trigger: data.trigger ?? "user_message",
      status: "in_progress",
      started_at: now,
    };
    this.turns.push(turn);
    return turn;
  }

  async findById(id: string): Promise<Turn | null> {
    return this.turns.find((t) => t.id === id) ?? null;
  }

  async findByConversation(conversationId: string, limit = 50): Promise<Turn[]> {
    return this.turns
      .filter((t) => t.conversation_id === conversationId)
      .slice(-limit)
      .reverse();
  }

  async updateStatus(
    id: string,
    status: TurnStatus,
    extra?: { assistantMessageId?: string; errorMessage?: string; completedAt?: string },
  ): Promise<Turn> {
    const idx = this.turns.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Turn not found: ${id}`);
    const now = extra?.completedAt ?? new Date().toISOString();
    this.turns[idx] = {
      ...this.turns[idx],
      status,
      completed_at: status !== "in_progress" ? now : this.turns[idx].completed_at,
      assistant_message_id:
        extra?.assistantMessageId ?? this.turns[idx].assistant_message_id,
      error_message: extra?.errorMessage ?? this.turns[idx].error_message,
    };
    return this.turns[idx];
  }
}

// ─── MemorySemanticEventRepository ───────────────────────────────────────────

export class MemorySemanticEventRepository implements ISemanticEventRepository {
  events: SemanticEvent[] = [];
  private seq = 1;

  async create(data: CreateSemanticEventInput): Promise<SemanticEvent> {
    const now = new Date().toISOString();
    const event: SemanticEvent = {
      id: data.id ?? `evt-${this.seq++}`,
      conversation_id: data.conversation_id,
      turn_id: data.turn_id,
      message_id: data.message_id,
      domain: data.domain,
      intent: data.intent,
      context_role: data.context_role,
      entities_json: data.entities ? JSON.stringify(data.entities) : undefined,
      confidence: data.confidence ?? 0.5,
      related_task_id: data.related_task_id,
      related_time_block_id: data.related_time_block_id,
      related_confirmation_id: data.related_confirmation_id,
      related_proposal_id: data.related_proposal_id,
      source: data.source,
      created_at: now,
    };
    this.events.push(event);
    return event;
  }

  async findByTurn(turnId: string): Promise<SemanticEvent[]> {
    return this.events.filter((e) => e.turn_id === turnId && !e.invalidated_at);
  }

  async findByConversation(
    conversationId: string,
    opts: { limit?: number; domain?: string; includeInvalidated?: boolean } = {},
  ): Promise<SemanticEvent[]> {
    let results = this.events.filter(
      (e) =>
        e.conversation_id === conversationId &&
        (opts.includeInvalidated || !e.invalidated_at) &&
        (opts.domain == null || e.domain === opts.domain),
    );
    if (opts.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async findByTask(taskId: string, limit = 50): Promise<SemanticEvent[]> {
    return this.events
      .filter((e) => e.related_task_id === taskId && !e.invalidated_at)
      .slice(0, limit);
  }

  async findByTimeBlock(timeBlockId: string, limit = 50): Promise<SemanticEvent[]> {
    return this.events
      .filter((e) => e.related_time_block_id === timeBlockId && !e.invalidated_at)
      .slice(0, limit);
  }

  async findByConfirmation(confirmationId: string): Promise<SemanticEvent[]> {
    return this.events.filter((e) => e.related_confirmation_id === confirmationId);
  }

  async invalidateByConversation(conversationId: string): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    this.events = this.events.map((e) => {
      if (e.conversation_id === conversationId && !e.invalidated_at) {
        count++;
        return { ...e, invalidated_at: now };
      }
      return e;
    });
    return count;
  }
}

// ─── MemoryActionLogPort ──────────────────────────────────────────────────────

export interface ActionLogEntry {
  id: string;
  userInput: string;
  detectedIntent?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  status: "pending" | "success" | "failure" | "cancelled";
  result?: unknown;
  error?: string;
  createdAt: string;
  // C2/G10: 绑定字段
  conversation_id?: string;
  turn_id?: string;
  message_id?: string;
  confirmation_id?: string;
}

export class MemoryActionLogPort {
  entries: ActionLogEntry[] = [];
  private seq = 1;

  async logRequest(
    userInput: string,
    detectedIntent?: string,
    binding?: { conversation_id?: string; turn_id?: string; message_id?: string; confirmation_id?: string }
  ): Promise<{ id: string }> {
    const entry: ActionLogEntry = {
      id: `log-${this.seq++}`,
      userInput,
      detectedIntent,
      status: "pending",
      createdAt: new Date().toISOString(),
      conversation_id: binding?.conversation_id,
      turn_id: binding?.turn_id,
      message_id: binding?.message_id,
      confirmation_id: binding?.confirmation_id,
    };
    this.entries.push(entry);
    return { id: entry.id };
  }

  async logToolExecution(
    logId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<void> {
    const entry = this.entries.find((e) => e.id === logId);
    if (entry) {
      entry.toolName = toolName;
      entry.toolArgs = toolArgs;
    }
  }

  async logSuccess(logId: string, result: unknown): Promise<void> {
    const entry = this.entries.find((e) => e.id === logId);
    if (entry) {
      entry.status = "success";
      entry.result = result;
    }
  }

  async logFailure(logId: string, errorMessage: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === logId);
    if (entry) {
      entry.status = "failure";
      entry.error = errorMessage;
    }
  }

  async logCancelled(logId: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === logId);
    if (entry) {
      entry.status = "cancelled";
    }
  }
}

// ─── MemoryActiveContextRepository ───────────────────────────────────────────

export class MemoryActiveContextRepository implements IActiveContextRepository {
  records: ActiveContext[] = [];
  private seq = 1;

  async create(data: CreateActiveContextInput): Promise<ActiveContext> {
    const now = new Date().toISOString();
    const ctx: ActiveContext = {
      id: data.id ?? `actx-${this.seq++}`,
      conversation_id: data.conversation_id,
      active_domain: data.active_domain,
      active_intent: data.active_intent,
      active_task_id: data.active_task_id,
      active_time_block_id: data.active_time_block_id,
      active_confirmation_id: data.active_confirmation_id,
      active_proposal_id: data.active_proposal_id,
      proposal_snapshot_json: data.proposal_snapshot_json,
      active_turn_id: data.active_turn_id,
      status: (data.status as ActiveContextStatus) ?? "active",
      expires_at: data.expires_at,
      created_at: now,
      updated_at: now,
    };
    this.records.push(ctx);
    return ctx;
  }

  async update(id: string, input: UpdateActiveContextInput): Promise<ActiveContext> {
    const now = new Date().toISOString();
    const idx = this.records.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`ActiveContext ${id} not found`);
    const updated = { ...this.records[idx], updated_at: now };
    if (input.status !== undefined) updated.status = input.status as ActiveContextStatus;
    if ("active_domain" in input) updated.active_domain = input.active_domain ?? undefined;
    if ("active_intent" in input) updated.active_intent = input.active_intent ?? undefined;
    if (input.expires_at !== undefined) updated.expires_at = input.expires_at ?? undefined;
    if ("active_confirmation_id" in input) updated.active_confirmation_id = input.active_confirmation_id ?? undefined;
    if ("active_proposal_id" in input) updated.active_proposal_id = input.active_proposal_id ?? undefined;
    if ("proposal_snapshot_json" in input) updated.proposal_snapshot_json = input.proposal_snapshot_json ?? undefined;
    if ("active_task_id" in input) updated.active_task_id = input.active_task_id ?? undefined;
    if ("active_time_block_id" in input) updated.active_time_block_id = input.active_time_block_id ?? undefined;
    if ("active_turn_id" in input) updated.active_turn_id = input.active_turn_id ?? undefined;
    this.records[idx] = updated;
    return updated;
  }

  async findById(id: string): Promise<ActiveContext | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }

  async findActiveByConversation(conversationId: string): Promise<ActiveContext | null> {
    const actives = this.records.filter(
      (r) => r.conversation_id === conversationId && r.status === "active",
    );
    if (!actives.length) return null;
    return actives.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  }

  async findByConfirmation(confirmationId: string): Promise<ActiveContext | null> {
    const matches = this.records.filter((r) => r.active_confirmation_id === confirmationId);
    if (!matches.length) return null;
    return matches.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  }

  async expireStale(now: string): Promise<number> {
    let count = 0;
    this.records = this.records.map((r) => {
      if (r.status === "active" && r.expires_at && r.expires_at < now) {
        count++;
        return { ...r, status: "expired" as ActiveContextStatus, updated_at: now };
      }
      return r;
    });
    return count;
  }

  async invalidateByConversation(conversationId: string): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    this.records = this.records.map((r) => {
      if (r.conversation_id === conversationId && r.status === "active") {
        count++;
        return { ...r, status: "invalidated" as ActiveContextStatus, updated_at: now };
      }
      return r;
    });
    return count;
  }

  async invalidateByActiveTaskId(taskId: string): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    this.records = this.records.map((r) => {
      if (r.active_task_id === taskId && r.status === "active") {
        count++;
        return { ...r, status: "invalidated" as ActiveContextStatus, updated_at: now };
      }
      return r;
    });
    return count;
  }
}

// ─── MemoryTraceStepRepository ────────────────────────────────────────────────

export class MemoryTraceStepRepository implements ITraceStepRepository {
  steps: AgentTraceStep[] = [];
  private seq = 1;

  async create(data: CreateTraceStepInput): Promise<AgentTraceStep> {
    const now = new Date().toISOString();
    const step: AgentTraceStep = {
      id: data.id ?? `step-${this.seq++}`,
      turn_id: data.turn_id,
      conversation_id: data.conversation_id,
      message_id: data.message_id,
      step_type: data.step_type,
      step_order: data.step_order,
      input_snapshot_json: data.input_snapshot_json,
      output_snapshot_json: data.output_snapshot_json,
      latency_ms: data.latency_ms,
      error: data.error,
      created_at: now,
    };
    this.steps.push(step);
    return step;
  }

  async createBatch(items: CreateTraceStepInput[]): Promise<AgentTraceStep[]> {
    return Promise.all(items.map((item) => this.create(item)));
  }

  async findByTurn(turnId: string): Promise<AgentTraceStep[]> {
    return this.steps
      .filter((s) => s.turn_id === turnId)
      .sort((a, b) => a.step_order - b.step_order || a.created_at.localeCompare(b.created_at));
  }

  async findByMessage(messageId: string): Promise<AgentTraceStep[]> {
    return this.steps
      .filter((s) => s.message_id === messageId)
      .sort((a, b) => a.step_order - b.step_order);
  }

  async findByConversation(
    conversationId: string,
    opts?: { limit?: number; stepType?: string; since?: string },
  ): Promise<AgentTraceStep[]> {
    let results = this.steps.filter(
      (s) =>
        s.conversation_id === conversationId &&
        (opts?.stepType == null || s.step_type === opts.stepType) &&
        (opts?.since == null || s.created_at >= opts.since),
    );
    results = results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async findLatestByConversation(
    conversationId: string,
    n: number,
  ): Promise<AgentTraceStep[]> {
    return this.findByConversation(conversationId, { limit: n });
  }

  async countByStepType(conversationId: string, stepType: string): Promise<number> {
    return this.steps.filter(
      (s) => s.conversation_id === conversationId && s.step_type === stepType,
    ).length;
  }
}
