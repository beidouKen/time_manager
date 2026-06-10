// ============================================================
// ContextAssembler.ts — C4 统一上下文组装器
//
// 职责（单一）：决定哪些上下文进入 LLM，每个 slot 取多少、截断多少。
// 不做业务判断、不做意图分类、不调 LLM、不写库。
//
// 调用时机：AgentService.processInput 在 startTurn 之后、classify 之前
// 调用一次；同一 turn 内 packet 复用，不重复 assemble。
//
// 失败策略：任何子查询异常 → 该 slot 退化为空，不阻塞主流程。
// ============================================================

import type { ConversationService } from "@/services/ConversationService";
import type { ConfirmationService } from "@/services/ConfirmationService";
import type { SemanticEventService } from "@/services/SemanticEventService";
import type { ActiveContextService } from "@/services/ActiveContextService";
import type { TaskService } from "@/services/TaskService";
import type { TimeBlockService } from "@/services/TimeBlockService";
import type {
  WorkingMemoryPacket,
  WorkingMemorySnapshot,
  PacketSliceSummary,
  ContextAssemblyInput,
  ContextAssemblyOptions,
  ActiveContextSummary,
  ConversationSummary,
  BusinessStateSummary,
  RelevantEvent,
} from "./WorkingMemoryPacket";

// ─── 默认取量 / 截断口径 ─────────────────────────────────────────────────────

const DEFAULTS: Required<ContextAssemblyOptions> = {
  recentMessagesLimit: 8,
  messageMaxChars: 300,
  eventsLimit: 12,
  tasksLimit: 5,
  timeBlocksLimit: 5,
  businessTitleMaxChars: 60,
  confirmationDescMaxChars: 200,
  lightweight: false,
};

// ─── ContextAssembler ────────────────────────────────────────────────────────

export class ContextAssembler {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly confirmationService: ConfirmationService,
    private readonly semanticEventService: SemanticEventService,
    private readonly activeContextService: ActiveContextService,
    private readonly taskService: TaskService,
    private readonly timeBlockService: TimeBlockService
  ) {}

  /**
   * 组装一次完整（或轻量）上下文包。
   * 任何 slot 失败都静默退化为空，不抛错。
   */
  async assemble(
    input: ContextAssemblyInput,
    options: ContextAssemblyOptions = {}
  ): Promise<WorkingMemoryPacket> {
    const opts: Required<ContextAssemblyOptions> = { ...DEFAULTS, ...options };
    const now = new Date().toISOString();
    const slotSummaries: PacketSliceSummary[] = [];

    // ── slot: conversation_summary ──────────────────────────────────────────
    let conversationSummary: ConversationSummary = { recentMessages: [], messageIds: [] };
    if (!opts.lightweight) {
      try {
        const msgs = await this.conversationService.loadRecent(
          opts.recentMessagesLimit,
          input.conversationId
        );
        const truncated = msgs.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content:
            m.content.length > opts.messageMaxChars
              ? m.content.slice(0, opts.messageMaxChars) + "…"
              : m.content,
          id: m.id,
        }));
        conversationSummary = {
          recentMessages: truncated,
          messageIds: truncated.map((m) => m.id ?? "").filter(Boolean),
        };
        slotSummaries.push({
          name: "conversation_summary",
          count: truncated.length,
          totalChars: truncated.reduce((s, m) => s + m.content.length, 0),
          sourceIds: conversationSummary.messageIds,
        });
      } catch {
        slotSummaries.push({ name: "conversation_summary", count: 0, totalChars: 0, sourceIds: [], failed: true });
      }
    }

    // ── slot: active_context_summary ─────────────────────────────────────────
    let activeContextSummary: ActiveContextSummary = { status: "no_active_context" };
    try {
      const activeCtx = await this.activeContextService.findActiveByConversation(
        input.conversationId ?? ""
      );
      if (activeCtx) {
        if (activeCtx.active_confirmation_id && activeCtx.proposal_snapshot_json) {
          let proposal: import("@/agent/types").PendingProposalSnapshot | undefined;
          try { proposal = JSON.parse(activeCtx.proposal_snapshot_json); } catch { /* ignore */ }
          activeContextSummary = {
            status: "pending_proposal",
            confirmationId: activeCtx.active_confirmation_id,
            proposalId: activeCtx.active_proposal_id,
            proposal,
            activeTaskId: activeCtx.active_task_id,
            activeTimeBlockId: activeCtx.active_time_block_id,
          };
        } else if (activeCtx.active_confirmation_id) {
          activeContextSummary = {
            status: "pending_confirmation",
            confirmationId: activeCtx.active_confirmation_id,
            activeTaskId: activeCtx.active_task_id,
            activeTimeBlockId: activeCtx.active_time_block_id,
          };
        } else if (activeCtx.active_task_id) {
          activeContextSummary = {
            status: "active_task_discussion",
            activeTaskId: activeCtx.active_task_id,
            activeTimeBlockId: activeCtx.active_time_block_id,
          };
        }
      }
      slotSummaries.push({
        name: "active_context_summary",
        count: activeCtx ? 1 : 0,
        totalChars: activeCtx ? (activeCtx.proposal_snapshot_json?.length ?? 0) : 0,
        sourceIds: activeCtx ? [activeCtx.id] : [],
      });
    } catch {
      slotSummaries.push({ name: "active_context_summary", count: 0, totalChars: 0, sourceIds: [], failed: true });
    }

    // ── slot: pending_confirmation_summary ────────────────────────────────────
    let pendingConfirmationSummary: WorkingMemoryPacket["pendingConfirmationSummary"];
    const confirmId = input.pendingConfirmationId ?? activeContextSummary.confirmationId;
    if (confirmId) {
      try {
        const conf = await this.confirmationService.getById(confirmId);
        if (conf && conf.status === "pending") {
          const desc = conf.description ?? "";
          pendingConfirmationSummary = {
            id: conf.id,
            actionType: conf.action_type,
            toolName: conf.tool_name,
            riskLevel: conf.risk_level,
            description:
              desc.length > opts.confirmationDescMaxChars
                ? desc.slice(0, opts.confirmationDescMaxChars) + "…"
                : desc,
            expiresAt: conf.expires_at,
          };
          slotSummaries.push({
            name: "pending_confirmation_summary",
            count: 1,
            totalChars: (pendingConfirmationSummary.description ?? "").length,
            sourceIds: [conf.id],
          });
        }
      } catch {
        slotSummaries.push({ name: "pending_confirmation_summary", count: 0, totalChars: 0, sourceIds: [], failed: true });
      }
    }

    // ── slot: relevant_events ─────────────────────────────────────────────────
    let relevantEvents: RelevantEvent[] = [];
    if (!opts.lightweight && input.conversationId) {
      try {
        const events = await this.semanticEventService.findByConversation(
          input.conversationId,
          { limit: opts.eventsLimit }
        );
        relevantEvents = events.map((e) => ({
          id: e.id,
          domain: e.domain,
          intent: e.intent,
          contextRole: e.context_role,
          confidence: e.confidence,
          createdAt: e.created_at,
        }));
        slotSummaries.push({
          name: "relevant_events",
          count: relevantEvents.length,
          totalChars: relevantEvents.length * 80,
          sourceIds: relevantEvents.map((e) => e.id),
        });
      } catch {
        slotSummaries.push({ name: "relevant_events", count: 0, totalChars: 0, sourceIds: [], failed: true });
      }
    }

    // ── slot: related_business_state ─────────────────────────────────────────
    let relatedBusinessState: BusinessStateSummary = { tasks: [], timeBlocks: [] };
    try {
      const [tasks, todayBlocks] = await Promise.all([
        this.taskService.getTasks({ excludeDeleted: true }).catch(() => []),
        this.timeBlockService.getBlocksForDate(new Date()).catch(() => []),
      ]);

      const trimTitle = (s: string) =>
        s.length > opts.businessTitleMaxChars
          ? s.slice(0, opts.businessTitleMaxChars) + "…"
          : s;

      relatedBusinessState = {
        tasks: tasks
          .filter((t) => t.status !== "done")
          .slice(0, opts.tasksLimit)
          .map((t) => ({
            id: t.id,
            title: trimTitle(t.title),
            status: t.status,
            priority: t.priority ?? undefined,
          })),
        timeBlocks: todayBlocks
          .filter((b) => !b.deleted_at)
          .slice(0, opts.timeBlocksLimit)
          .map((b) => ({
            id: b.id,
            title: trimTitle(b.title),
            startTime: b.start_time,
            endTime: b.end_time,
            status: b.status,
          })),
      };
      slotSummaries.push({
        name: "related_business_state",
        count: relatedBusinessState.tasks.length + relatedBusinessState.timeBlocks.length,
        totalChars:
          relatedBusinessState.tasks.reduce((s, t) => s + t.title.length, 0) +
          relatedBusinessState.timeBlocks.reduce((s, b) => s + b.title.length, 0),
        sourceIds: [
          ...relatedBusinessState.tasks.map((t) => t.id),
          ...relatedBusinessState.timeBlocks.map((b) => b.id),
        ],
      });
    } catch {
      slotSummaries.push({ name: "related_business_state", count: 0, totalChars: 0, sourceIds: [], failed: true });
    }

    // ── slot: current_user_input ──────────────────────────────────────────────
    slotSummaries.push({
      name: "current_user_input",
      count: 1,
      totalChars: input.userInput.length,
      sourceIds: [],
    });

    // ── source_ids 汇总 ────────────────────────────────────────────────────────
    const sourceIds = {
      conversationId: input.conversationId,
      turnId: input.turnId,
      messageIds: conversationSummary.messageIds,
      eventIds: relevantEvents.map((e) => e.id),
    };

    // V3.9 Context OS four-segment mapping documented in
    // docs/V3.9_Agent Intelligence & Semantic Reliability/V3.9.4-context-os-mapping.md
    // (TurnContext / ConversationFocus / OperationalContext / RecentActionContext).
    return {
      currentUserInput: input.userInput,
      conversationSummary,
      activeContextSummary,
      pendingConfirmationSummary,
      relevantEvents,
      relatedBusinessState,
      sourceIds,
      assembledAt: now,
    };
  }

  // ─── 轻量版 assemble（confirmAction / rejectAction / refineRecommendation 入口用） ────

  /**
   * 轻量版本：仅含 current_user_input + active_context_summary + pending_confirmation_summary。
   * 省略 recent_messages / relevant_events 的 DB 查询，适合 confirm/reject/refine 路径。
   */
  async assembleLightweight(
    input: ContextAssemblyInput,
    options: Omit<ContextAssemblyOptions, "lightweight"> = {}
  ): Promise<WorkingMemoryPacket> {
    return this.assemble(input, { ...options, lightweight: true });
  }

  // ─── 辅助：从 packet 生成 AgentTrace 写入的轻量 snapshot ──────────────────

  static toSnapshot(
    packet: WorkingMemoryPacket,
    slotSummaries?: PacketSliceSummary[]
  ): WorkingMemorySnapshot {
    if (slotSummaries) {
      return {
        slotSummaries,
        assembledAt: packet.assembledAt,
        conversationId: packet.sourceIds.conversationId,
        turnId: packet.sourceIds.turnId,
      };
    }
    // 从 packet 自身重建摘要
    const builtSummaries: PacketSliceSummary[] = [
      {
        name: "current_user_input",
        count: 1,
        totalChars: packet.currentUserInput.length,
        sourceIds: [],
      },
      {
        name: "conversation_summary",
        count: packet.conversationSummary.recentMessages.length,
        totalChars: packet.conversationSummary.recentMessages.reduce(
          (s, m) => s + m.content.length, 0
        ),
        sourceIds: packet.conversationSummary.messageIds,
      },
      {
        name: "active_context_summary",
        count: packet.activeContextSummary.status !== "no_active_context" ? 1 : 0,
        totalChars: 0,
        sourceIds: [],
      },
      {
        name: "relevant_events",
        count: packet.relevantEvents.length,
        totalChars: packet.relevantEvents.length * 80,
        sourceIds: packet.sourceIds.eventIds,
      },
      {
        name: "related_business_state",
        count:
          packet.relatedBusinessState.tasks.length +
          packet.relatedBusinessState.timeBlocks.length,
        totalChars:
          packet.relatedBusinessState.tasks.reduce((s, t) => s + t.title.length, 0) +
          packet.relatedBusinessState.timeBlocks.reduce((s, b) => s + b.title.length, 0),
        sourceIds: [
          ...packet.relatedBusinessState.tasks.map((t) => t.id),
          ...packet.relatedBusinessState.timeBlocks.map((b) => b.id),
        ],
      },
    ];
    return {
      slotSummaries: builtSummaries,
      assembledAt: packet.assembledAt,
      conversationId: packet.sourceIds.conversationId,
      turnId: packet.sourceIds.turnId,
    };
  }
}
