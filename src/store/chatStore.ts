import { create } from "zustand";
import { AgentService } from "@/agent/AgentService";
import type { AgentResponse } from "@/agent/AgentService";
import type { ChatMessageMetadata, PendingProposalSnapshot } from "@/agent/types";
import type { AgentExperienceContext, ExperienceActionPlan, SemanticFrame } from "@/agent/types";
import { ResponseBoundary } from "@/agent/experience/ResponseBoundary";
import { ConversationService } from "@/services/ConversationService";
import { ActiveContextService } from "@/services/ActiveContextService";
import { ContextInvalidationService } from "@/services/ContextInvalidationService";
import type { ConversationMessage } from "@/types/agent.types";
import { useTaskStore } from "@/store/taskStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useUiStore } from "@/store/uiStore";

const agentService = new AgentService();
const conversationService = new ConversationService();
const activeContextService = new ActiveContextService();
const contextInvalidationService = new ContextInvalidationService();
const responseBoundary = new ResponseBoundary();

// ─── ChatMessage 类型（前端运行时状态） ──────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /**
   * V2.5：结构化 metadata，包含 intent、toolName、actionLogId、confirmationId 等。
   * 序列化后存入 conversation_messages.metadata_json；
   * 加载历史时从 metadata_json 反序列化还原。
   *
   * 兼容说明：confirmationId 字段同时保留在顶层（向后兼容旧数据），
   * 新写入数据统一放在 metadata.confirmationId。
   */
  metadata?: ChatMessageMetadata;
  /** @deprecated 请使用 metadata.confirmationId；保留仅用于向后兼容历史数据 */
  confirmationId?: string;
  timestamp: string;
}

interface ChatState {
  messages: ChatMessage[];
  isProcessing: boolean;
  error: string | null;
  /**
   * C1: 当前活跃会话 ID。
   * init/loadHistory 时由 ensureDefaultConversation 赋值。
   */
  currentConversationId: string | null;
  /**
   * V3.8: 当前存在的推荐类待确认提案快照（内存缓存）。
   * 由 TimeManagementAgent 写入 metadata.pendingProposal，
   * chatStore 回流时缓存，下一轮 sendMessage 时透传给 AgentService。
   * confirmAction / rejectAction 后清空。
   */
  pendingProposal: PendingProposalSnapshot | null;
}

interface ChatActions {
  sendMessage: (content: string) => Promise<void>;
  confirmAction: (confirmationId: string) => Promise<void>;
  rejectAction: (confirmationId: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
  /** C5: 仅失效当前会话（不新建新会话），供未来"归档"按钮复用 */
  invalidateCurrentConversation: () => Promise<void>;
}

// ─── 辅助：从 AgentResponse 提取 metadata_json 字符串 ────────────────────

function buildMetadataJson(response: AgentResponse): string | undefined {
  if (response.metadata) {
    return JSON.stringify(response.metadata);
  }
  // 降级：至少保存 confirmationId（兼容旧路径）
  if (response.confirmationId) {
    return JSON.stringify({ confirmationId: response.confirmationId });
  }
  return undefined;
}

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

async function applyRefreshHints(response: AgentResponse): Promise<void> {
  const hints = response.refreshHints;
  if (!hints) return;

  const refreshes: Array<Promise<void>> = [];
  if (hints.tasks) {
    refreshes.push(useTaskStore.getState().loadTasks());
  }
  if (hints.timeline) {
    refreshes.push(
      hints.timelineDate
        ? useTimeBlockStore
            .getState()
            .loadBlocksForDate(parseDateKey(hints.timelineDate))
        : useTimeBlockStore.getState().refreshBlocks()
    );
  }

  await Promise.all(refreshes);
}

/**
 * 从持久化的 metadata_json 解析 ChatMessageMetadata。
 * 同时兼容旧数据（只存了 confirmationId 的格式）。
 */
function parseMetadata(metadataJson?: string): ChatMessageMetadata | undefined {
  if (!metadataJson) return undefined;
  try {
    return JSON.parse(metadataJson) as ChatMessageMetadata;
  } catch {
    return undefined;
  }
}

/**
 * V3.7 P0-1: 判断一条 ChatMessage 当前是否应该显示「确认/取消」按钮。
 * 与 ChatMessage.tsx 中的渲染条件保持一致，便于单测和组件复用。
 */
export function shouldShowConfirmationButtons(message: ChatMessage): boolean {
  if (message.role !== "assistant") return false;
  const confirmationId =
    message.metadata?.confirmationId ?? message.confirmationId;
  if (!confirmationId) return false;
  const resultType = message.metadata?.resultType;
  return resultType === undefined || resultType === "pending_confirmation";
}

/**
 * V3.7 P0-1: 计算 patch 旧消息的结果，纯函数，便于单测。
 */
export function applyConfirmationPatch(
  messages: ChatMessage[],
  confirmationId: string,
  newResultType: "success" | "failure" | "rejected"
): {
  messages: ChatMessage[];
  patches: Array<{ id: string; metadataJson: string }>;
} {
  const patches: Array<{ id: string; metadataJson: string }> = [];
  const next = messages.map((m) => {
    const matches =
      m.role === "assistant" &&
      ((m.metadata?.confirmationId ?? m.confirmationId) === confirmationId) &&
      (m.metadata?.resultType === undefined ||
        m.metadata?.resultType === "pending_confirmation");
    if (!matches) return m;

    const nextMetadata: ChatMessageMetadata = {
      ...(m.metadata ?? {}),
      confirmationId,
      resultType: newResultType,
    };
    patches.push({ id: m.id, metadataJson: JSON.stringify(nextMetadata) });
    return { ...m, metadata: nextMetadata };
  });
  return { messages: next, patches };
}

/**
 * V3.7 P0-1: confirmAction / rejectAction 的副作用收尾流程。
 */
async function runConfirmationFinalize(
  set: (
    fn: (
      state: ChatState & ChatActions
    ) => Partial<ChatState & ChatActions>
  ) => void,
  get: () => ChatState & ChatActions,
  confirmationId: string,
  response: AgentResponse,
  newResultType: "success" | "failure" | "rejected"
): Promise<void> {
  const newMsgId = crypto.randomUUID();
  let collectedPatches: Array<{ id: string; metadataJson: string }> = [];
  const conversationId = get().currentConversationId ?? undefined;

  set((state) => {
    const { messages: patched, patches } = applyConfirmationPatch(
      state.messages,
      confirmationId,
      newResultType
    );
    collectedPatches = patches;
    const newMsg: ChatMessage = {
      id: newMsgId,
      role: "assistant",
      content: response.message,
      metadata: response.metadata,
      timestamp: new Date().toISOString(),
    };
    return {
      messages: [...patched, newMsg],
      isProcessing: false,
    };
  });

  await Promise.all(
    collectedPatches.map(({ id, metadataJson }) =>
      conversationService
        .updateMessageMetadata(id, metadataJson)
        .catch((err) =>
          console.warn(
            "[chatStore] updateMessageMetadata failed:",
            id,
            err
          )
        )
    )
  );

  await conversationService.createMessage({
    id: newMsgId,
    conversation_id: conversationId,
    role: "assistant",
    content: response.message,
    metadata_json: buildMetadataJson(response),
  });
}

// ─── Store ────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatState & ChatActions>((set, _get) => ({
  messages: [],
  isProcessing: false,
  error: null,
  currentConversationId: null,
  pendingProposal: null,

  loadHistory: async () => {
    try {
      // C1: 确保 default conversation 存在，并拿到 conversationId
      let conversationId: string | null = null;
      try {
        const conv = await conversationService.ensureDefaultConversation();
        conversationId = conv.id;
        set({ currentConversationId: conversationId });
      } catch {
        // DB 不可用时降级
      }

      const history = await conversationService.loadRecent(50, conversationId ?? undefined);
      const messages: ChatMessage[] = history.map((m: ConversationMessage) => {
        const meta = parseMetadata(m.metadata_json);
        return {
          id: m.id,
          role: m.role as ChatMessage["role"],
          content: m.content,
          metadata: meta,
          confirmationId: meta?.confirmationId,
          timestamp: m.created_at,
        };
      });
      set({ messages });

      // C3 B1 修复：从 DB 还原 pendingProposal（页面刷新后 loadHistory 重建内存状态）
      if (conversationId) {
        try {
          const active = await activeContextService.findActiveByConversation(conversationId);
          if (active?.proposal_snapshot_json) {
            const snapshot = JSON.parse(active.proposal_snapshot_json) as PendingProposalSnapshot;
            set({ pendingProposal: snapshot });
          }
        } catch { /* 降级：保持 null */ }
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  sendMessage: async (content: string) => {
    set({ isProcessing: true, error: null });

    // C1: 确保 conversationId
    let conversationId = _get().currentConversationId;
    if (!conversationId) {
      try {
        const conv = await conversationService.ensureDefaultConversation();
        conversationId = conv.id;
        set({ currentConversationId: conversationId });
      } catch {
        // DB 不可用时降级
      }
    }

    const recentMessages = _get()
      .messages.slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    // C1: 预生成 userMessageId 和 assistantMessageId
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();

    const userMsg: ChatMessage = {
      id: userMessageId,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));

    // 持久化用户消息，带 conversation_id
    await conversationService.createMessage({
      id: userMessageId,
      conversation_id: conversationId ?? undefined,
      role: "user",
      content,
    });

    try {
      const currentTimelineDate = formatLocalDateKey(
        useTimeBlockStore.getState().currentDate
      );
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";

      const allMessages = _get().messages;
      const lastAssistantMsg = [...allMessages].reverse().find(m => m.role === "assistant");
      const lastResultType = lastAssistantMsg?.metadata?.resultType;
      const pendingConfirmationId =
        (lastResultType === "pending_confirmation" || lastResultType === undefined)
          ? (lastAssistantMsg?.metadata?.confirmationId ?? lastAssistantMsg?.confirmationId)
          : undefined;
      const pendingClarification =
        lastAssistantMsg?.metadata?.llmResponseType === "clarification" ||
        (!!lastAssistantMsg?.metadata?.confirmationId && lastResultType !== "success" && lastResultType !== "failure" && lastResultType !== "rejected");

      // C3: 内存空时从 DB 兜底补 pendingProposal（保护 sendMessage 先于 loadHistory 的 race 窗口）
      let pendingProposal = _get().pendingProposal ?? undefined;
      if (!pendingProposal && conversationId) {
        try {
          const activeCtx = await activeContextService.findActiveByConversation(conversationId);
          if (activeCtx?.proposal_snapshot_json) {
            pendingProposal = JSON.parse(activeCtx.proposal_snapshot_json) as PendingProposalSnapshot;
          }
        } catch { /* 降级：保持 undefined */ }
      }

      const response: AgentResponse = await agentService.processInput(content, {
        recentMessages,
        timezone,
        currentTimelineDate,
        selectedDate: currentTimelineDate,
        currentScreen: useUiStore.getState().activePage,
        pendingConfirmationId: pendingConfirmationId ?? undefined,
        pendingClarification,
        pendingProposal,
        // C1: ID 贯穿
        conversationId: conversationId ?? undefined,
        userMessageId,
        assistantMessageId,
      });

      // C3 G5 修复：仅当本轮显式产出新提案才覆盖；否则保留旧值（DB 才是权威）。
      // 旧逻辑：非 pending_confirmation 响应会清空 pendingProposal，导致跨话题插入后丢失。
      const newPendingProposal =
        response.metadata?.pendingProposal ?? _get().pendingProposal;

      const assistantMsg: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: response.message,
        metadata: response.metadata,
        confirmationId: response.confirmationId ?? response.metadata?.confirmationId,
        timestamp: new Date().toISOString(),
      };

      set((s) => ({
        messages: [...s.messages, assistantMsg],
        isProcessing: false,
        pendingProposal: newPendingProposal,
      }));

      // 持久化 assistant 消息，带 conversation_id 和 turn_id
      await conversationService.createMessage({
        id: assistantMessageId,
        conversation_id: conversationId ?? undefined,
        turn_id: response.metadata?.turnId,
        role: "assistant",
        content: response.message,
        metadata_json: buildMetadataJson(response),
      });

      await applyRefreshHints(response);
    } catch (e) {
      const fallbackContext: AgentExperienceContext = {
        currentDatetime: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
        recentMessages: [],
        lastCreatedTaskId: null,
        lastMentionedTaskIds: [],
        lastScheduledTimeBlockIds: [],
        lastToolResults: [],
      };
      const fallbackFrame: SemanticFrame = {
        userGoal: "general_chat",
        objectReferences: [],
        timeExpressions: [],
        durationExpressions: [],
        constraints: {},
        userTone: "neutral",
        urgency: "normal",
        missingInfo: [],
        confidence: 0.1,
      };
      const fallbackPlan: ExperienceActionPlan = {
        id: crypto.randomUUID(),
        kind: "direct_response",
        userGoal: "general_chat",
        params: {},
        requiresConfirmation: false,
        riskLevel: "safe",
        summary: "store_error",
        createdAt: new Date().toISOString(),
      };
      const safeMessage = responseBoundary.finalize({
        context: fallbackContext,
        frame: fallbackFrame,
        plan: fallbackPlan,
        result: {
          domain: "general_chat",
          responseKind: "tool_failure",
        },
      });
      const errorMsgId = crypto.randomUUID();
      const errorMsg: ChatMessage = {
        id: errorMsgId,
        role: "assistant",
        content: safeMessage,
        timestamp: new Date().toISOString(),
        metadata: { resultType: "failure", source: "llm" },
      };
      set((s) => ({
        messages: [...s.messages, errorMsg],
        isProcessing: false,
        error: String(e),
      }));
      // G7: 持久化 error assistant 消息
      try {
        await conversationService.createMessage({
          id: errorMsgId,
          conversation_id: conversationId ?? undefined,
          role: "assistant",
          content: safeMessage,
          metadata_json: JSON.stringify({ resultType: "failure", error: String(e) }),
        });
      } catch (persistErr) {
        console.warn("[chatStore] Failed to persist error message:", persistErr);
      }
    }
  },

  confirmAction: async (confirmationId: string) => {
    set({ isProcessing: true });
    try {
      const conversationId = _get().currentConversationId ?? undefined;
      const response = await agentService.confirmAction(confirmationId, { conversationId });
      const newResultType: "success" | "failure" =
        response.metadata?.resultType === "failure" ? "failure" : "success";
      await runConfirmationFinalize(set, _get, confirmationId, response, newResultType);
      set({ pendingProposal: null });
      await applyRefreshHints(response);
    } catch (e) {
      set({ isProcessing: false, error: String(e) });
    }
  },

  rejectAction: async (confirmationId: string) => {
    set({ isProcessing: true });
    try {
      const conversationId = _get().currentConversationId ?? undefined;
      const response = await agentService.rejectAction(confirmationId, { conversationId });
      await runConfirmationFinalize(set, _get, confirmationId, response, "rejected");
      set({ pendingProposal: null });
    } catch (e) {
      set({ isProcessing: false, error: String(e) });
    }
  },

  // C5: clearHistory → 调统一入口 ContextInvalidationService 完整四层级联失效 + 新建会话
  clearHistory: async () => {
    const oldId = _get().currentConversationId;

    let newConvId: string | null = null;
    try {
      const newConv = await conversationService.createConversation();
      newConvId = newConv.id;
    } catch { /* ignore */ }

    // 先进入新会话（UI 不卡顿），再后台 invalidate 旧会话
    set({ messages: [], currentConversationId: newConvId, pendingProposal: null });

    if (oldId) {
      try {
        await contextInvalidationService.invalidateConversation(oldId, { reason: "user_clear" });
      } catch (e) {
        console.warn("[chatStore] clearHistory cascade invalidate failed:", e);
      }
    }
  },

  // C5: 仅失效当前会话（不新建新会话），供未来"归档"等按钮复用
  invalidateCurrentConversation: async () => {
    const convId = _get().currentConversationId;
    if (!convId) return;
    try {
      await contextInvalidationService.invalidateConversation(convId, { reason: "archive" });
    } catch (e) {
      console.warn("[chatStore] invalidateCurrentConversation failed:", e);
    }
  },
}));
