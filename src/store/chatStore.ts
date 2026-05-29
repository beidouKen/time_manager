import { create } from "zustand";
import { AgentService } from "@/agent/AgentService";
import type { AgentResponse } from "@/agent/AgentService";
import type { ChatMessageMetadata } from "@/agent/types";
import { SqliteConversationRepository } from "@/repositories/sqlite/SqliteConversationRepository";
import type { ConversationMessage } from "@/types/agent.types";
import { useTaskStore } from "@/store/taskStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useUiStore } from "@/store/uiStore";

const agentService = new AgentService();
const conversationRepo = new SqliteConversationRepository();

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

// ─── Store ────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatState & ChatActions>((set, _get) => ({
  messages: [],
  isProcessing: false,
  error: null,

  loadHistory: async () => {
    try {
      const history = await conversationRepo.findRecent(50);
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

    // 持久化用户消息（无 metadata）
    await conversationRepo.create({ role: "user", content });

    try {

      const currentTimelineDate = formatLocalDateKey(
        useTimeBlockStore.getState().currentDate
      );
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";

      const response: AgentResponse = await agentService.processInput(content, {
        recentMessages,
        timezone,
        currentTimelineDate,
        selectedDate: currentTimelineDate,
        currentScreen: useUiStore.getState().activePage,
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

      // 持久化 assistant 消息，带 metadata_json
      await conversationRepo.create({
        role: "assistant",
        content: response.message,
        metadata_json: buildMetadataJson(response),
      });

      await applyRefreshHints(response);
    } catch (e) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `处理失败: ${String(e)}`,
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

      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.message,
        metadata: response.metadata,
        timestamp: new Date().toISOString(),
      };
      set((s) => ({
        messages: [...s.messages, msg],
        isProcessing: false,
      }));

      await conversationRepo.create({
        role: "assistant",
        content: response.message,
        metadata_json: buildMetadataJson(response),
      });

      await applyRefreshHints(response);
    } catch (e) {
      set({ isProcessing: false, error: String(e) });
    }
  },

  rejectAction: async (confirmationId: string) => {
    set({ isProcessing: true });
    try {
      const response = await agentService.rejectAction(confirmationId);

      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.message,
        metadata: response.metadata,
        timestamp: new Date().toISOString(),
      };
      set((s) => ({
        messages: [...s.messages, msg],
        isProcessing: false,
      }));

      await conversationRepo.create({
        role: "assistant",
        content: response.message,
        metadata_json: buildMetadataJson(response),
      });
    } catch (e) {
      set({ isProcessing: false, error: String(e) });
    }
  },

  clearHistory: async () => {
    await conversationRepo.deleteAll();
    set({ messages: [] });
  },
}));
