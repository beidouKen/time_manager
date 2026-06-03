import { create } from "zustand";
import { AgentService } from "@/agent/AgentService";
import type { AgentResponse } from "@/agent/AgentService";
import type { ChatMessageMetadata } from "@/agent/types";
import type { AgentExperienceContext, ExperienceActionPlan, SemanticFrame } from "@/agent/types";
import { ResponseBoundary } from "@/agent/experience/ResponseBoundary";
import { ConversationService } from "@/services/ConversationService";
import type { ConversationMessage } from "@/types/agent.types";
import { useTaskStore } from "@/store/taskStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useUiStore } from "@/store/uiStore";
import { SqliteRagAdapter } from "@/agent/memory/SqliteRagAdapter";
import { createDefaultRagEngine } from "@/services/rag/engine/RagEngineFactory";
import {
  buildSelfHostedHybridRetriever,
  isSelfHostedRagEngineEnabled,
} from "@/services/rag/retrieval/buildSelfHostedHybridRetriever";
import { VectorRagService } from "@/services/rag/VectorRagService";
import { useRagKnowledgeStore } from "@/store/ragKnowledgeStore";
import type { RagSourceType } from "@/types/rag.types";

// V3.8.1: Chat 主路径接入真实 RAG，支持用户在 Settings 切换 user_material 开关。
// 双门控：
//   1) 全局 toggle (userMaterialInChatEnabled) = ON
//   2) 文档 status='active'（由 RagService.retrieve 默认硬过滤兜底）
// 默认仅检索 seed_knowledge；只有当 toggle 打开时才追加 user_material。
const selfHostedEnabled = isSelfHostedRagEngineEnabled();
const ragEngine = selfHostedEnabled ? createDefaultRagEngine() : undefined;
const selfHostedHybridRetriever =
  selfHostedEnabled && !ragEngine ? buildSelfHostedHybridRetriever() : undefined;

const agentService = new AgentService({
  ragAdapter: new SqliteRagAdapter({
    defaultSourceTypes: ["seed_knowledge"],
    sourceTypesProvider: (): RagSourceType[] => {
      const allow = useRagKnowledgeStore.getState().userMaterialInChatEnabled;
      return allow ? ["seed_knowledge", "user_material"] : ["seed_knowledge"];
    },
    defaultLimit: 2,
    vectorService: new VectorRagService(),
    hybridRetriever: selfHostedHybridRetriever,
    ragEngine,
  }),
});
const conversationService = new ConversationService();
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
}

interface ChatActions {
  sendMessage: (content: string) => Promise<void>;
  confirmAction: (confirmationId: string) => Promise<void>;
  rejectAction: (confirmationId: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
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
 * - 找到 role=assistant 且 metadata.confirmationId 命中的所有消息（理论上只有 1 条）。
 * - 仅当原 resultType 为 undefined / "pending_confirmation" 时 patch；
 *   已经是终态（success/failure/rejected）的不再变更。
 *
 * 返回 patched messages 列表 + 需要持久化的 patch 信息。
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
 *
 * 1. 在内存里 patch 同 confirmationId 的旧 assistant 消息的 resultType；
 * 2. append 新的「执行结果」消息；
 * 3. 通过 ConversationService.updateMessageMetadata 把 patch 持久化到 DB；
 * 4. 持久化新消息。
 *
 * 这样既能保证当前 session 中按钮立即消失，也能保证页面刷新后旧消息上的按钮不复活。
 */
async function runConfirmationFinalize(
  set: (
    fn: (
      state: ChatState & ChatActions
    ) => Partial<ChatState & ChatActions>
  ) => void,
  confirmationId: string,
  response: AgentResponse,
  newResultType: "success" | "failure" | "rejected"
): Promise<void> {
  const newMsgId = crypto.randomUUID();
  let collectedPatches: Array<{ id: string; metadataJson: string }> = [];

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

  loadHistory: async () => {
    try {
      const history = await conversationService.loadRecent(50);
      const messages: ChatMessage[] = history.map((m: ConversationMessage) => {
        const meta = parseMetadata(m.metadata_json);
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          metadata: meta,
          // 向后兼容：旧数据的 confirmationId 可能直接存在 metadata_json 顶层
          confirmationId: meta?.confirmationId,
          timestamp: m.created_at,
        };
      });
      set({ messages });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  sendMessage: async (content: string) => {
    set({ isProcessing: true, error: null });

    // V3.5 fix: 先取历史消息（不含当前输入），再 append userMsg
    // 这样 recentMessages 只包含历史，当前输入仅通过 userInput 传入 AgentService
    const recentMessages = _get()
      .messages.slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));

    // 持久化用户消息（无 metadata），用同一 id 让 in-memory 与 DB 行 id 对齐。
    await conversationService.createMessage({
      id: userMsg.id,
      role: "user",
      content,
    });

    try {

      const currentTimelineDate = formatLocalDateKey(
        useTimeBlockStore.getState().currentDate
      );
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";

      // 从最近一条 assistant 消息提取 pending 状态，供路由器做上下文感知。
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

      const response: AgentResponse = await agentService.processInput(content, {
        recentMessages,
        timezone,
        currentTimelineDate,
        selectedDate: currentTimelineDate,
        currentScreen: useUiStore.getState().activePage,
        pendingConfirmationId: pendingConfirmationId ?? undefined,
        pendingClarification,
      });

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.message,
        metadata: response.metadata,
        confirmationId: response.confirmationId ?? response.metadata?.confirmationId,
        timestamp: new Date().toISOString(),
      };

      set((s) => ({
        messages: [...s.messages, assistantMsg],
        isProcessing: false,
      }));

      // 持久化 assistant 消息，复用 in-memory id；后续 updateMetadata 才能命中同一行。
      await conversationService.createMessage({
        id: assistantMsg.id,
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
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: safeMessage,
        timestamp: new Date().toISOString(),
      };
      set((s) => ({
        messages: [...s.messages, errorMsg],
        isProcessing: false,
        error: String(e),
      }));
    }
  },

  confirmAction: async (confirmationId: string) => {
    set({ isProcessing: true });
    try {
      const response = await agentService.confirmAction(confirmationId);
      const newResultType: "success" | "failure" =
        response.metadata?.resultType === "failure" ? "failure" : "success";
      await runConfirmationFinalize(set, confirmationId, response, newResultType);
      await applyRefreshHints(response);
    } catch (e) {
      set({ isProcessing: false, error: String(e) });
    }
  },

  rejectAction: async (confirmationId: string) => {
    set({ isProcessing: true });
    try {
      const response = await agentService.rejectAction(confirmationId);
      await runConfirmationFinalize(set, confirmationId, response, "rejected");
    } catch (e) {
      set({ isProcessing: false, error: String(e) });
    }
  },

  clearHistory: async () => {
    await conversationService.clearAll();
    set({ messages: [] });
  },
}));
