// ============================================================
// WorkingMemoryPacket.ts — C4 统一上下文包
//
// ContextAssembler 的输出契约。
// 所有 LLM 入口（LLMExperiencePlanner / LLMDomainClassifier /
// LLMChatExecutor / PendingProposalInterpreter）消费此结构，
// 不再各自手工拼装原始 messages / pending state / DB 摘要。
//
// 设计约束：
// - 只读数据结构，组装后不变
// - 不含业务判断逻辑
// - 软删除 / 失效的消息和事件不进入此结构
// ============================================================

// ─── PacketSlice 摘要（写入 AgentTrace.workingMemorySnapshot） ─────────────

/**
 * 单个 slot 的轻量摘要，写入 AgentTrace 供 dev 期调试。
 * 不写全文，只记录 slot 元信息。
 */
export interface PacketSliceSummary {
  name: string;
  count: number;
  totalChars: number;
  sourceIds: string[];
  failed?: boolean;
}

// ─── WorkingMemoryPacket ────────────────────────────────────────────────────

export interface ConversationSummary {
  /** 最近 N 条非软删除消息（截断后） */
  recentMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    id?: string;
  }>;
  /** 入选消息的 id 列表（source 追溯） */
  messageIds: string[];
}

export interface ActiveContextSummary {
  status: "pending_confirmation" | "pending_proposal" | "active_task_discussion" | "no_active_context";
  confirmationId?: string;
  proposalId?: string;
  /** proposal 快照（若 pending_proposal） */
  proposal?: import("@/agent/types").PendingProposalSnapshot;
  activeTaskId?: string;
  activeTimeBlockId?: string;
}

export interface PendingConfirmationSummary {
  id: string;
  actionType: string;
  toolName: string;
  riskLevel: string;
  description?: string;
  expiresAt?: string;
}

export interface RelevantEvent {
  id: string;
  domain: string;
  intent: string;
  contextRole: string;
  confidence: number;
  createdAt: string;
}

export interface BusinessStateSummary {
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority?: string;
  }>;
  timeBlocks: Array<{
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    status: string;
  }>;
}

/**
 * WorkingMemoryPacket — ContextAssembler 的输出契约。
 * 单次 turn 内复用，不重复组装。
 */
export interface WorkingMemoryPacket {
  /** 当前轮用户原始输入 */
  currentUserInput: string;

  /** 最近消息 slot */
  conversationSummary: ConversationSummary;

  /** 当前 active_context 状态 */
  activeContextSummary: ActiveContextSummary;

  /** 当前 pending confirmation 摘要（若存在） */
  pendingConfirmationSummary?: PendingConfirmationSummary;

  /** 最近 K 条 SemanticEvent（按 conversation_id，排除 invalidated_at IS NOT NULL） */
  relevantEvents: RelevantEvent[];

  /** 最近引用 / 创建的 task + time_block 快照 */
  relatedBusinessState: BusinessStateSummary;

  /** 全部 source 追溯 */
  sourceIds: {
    conversationId?: string;
    turnId?: string;
    messageIds: string[];
    eventIds: string[];
  };

  /** 组装时间戳 */
  assembledAt: string;
}

// ─── ContextAssemblyInput / ContextAssemblyOptions ─────────────────────────

export interface ContextAssemblyInput {
  userInput: string;
  conversationId?: string;
  turnId?: string;
  /** 调用方已知的 pending confirmation ID（通常来自 chatStore 或 active context Stage 0） */
  pendingConfirmationId?: string;
}

export interface ContextAssemblyOptions {
  /** 最近消息取量，默认 8 */
  recentMessagesLimit?: number;
  /** 单条消息截断字数，默认 300 */
  messageMaxChars?: number;
  /** SemanticEvent 取量，默认 12 */
  eventsLimit?: number;
  /** 关联 task 取量，默认 5 */
  tasksLimit?: number;
  /** 关联 time_block 取量，默认 5 */
  timeBlocksLimit?: number;
  /** task/time_block title 截断字数，默认 60 */
  businessTitleMaxChars?: number;
  /** pending_confirmation description 截断字数，默认 200 */
  confirmationDescMaxChars?: number;
  /** 是否是 lightweight 模式（省略 recent_messages / relevant_events DB 查询） */
  lightweight?: boolean;
}

// ─── WorkingMemorySnapshot（写入 AgentTrace 的轻量摘要） ───────────────────

/**
 * 写入 AgentTrace.workingMemorySnapshot 的轻量摘要。
 * 仅含 slot 元信息（name/count/total_chars/source_ids），不含全文。
 */
export interface WorkingMemorySnapshot {
  slotSummaries: PacketSliceSummary[];
  assembledAt: string;
  conversationId?: string;
  turnId?: string;
}
