import { create } from "zustand";
import { AgentService } from "@/agent/AgentService";
import type { AgentResponse } from "@/agent/AgentService";
import type { ChatMessageMetadata } from "@/agent/types";
import { SqliteConversationRepository } from "@/repositories/sqlite/SqliteConversationRepository";
import type { ConversationMessage } from "@/types/agent.types";

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
      // V3：将最近消息作为上下文传给 AgentService，用于 LLM 指代消解
      // 注意：传入的是追加 userMsg 之前的消息列表（不含当前消息，避免重复）
      // 当前用户消息由 AgentService 直接作为 userInput 处理
      const currentMessages = _get().messages;
      const recentMessages = currentMessages
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const response: AgentResponse = await agentService.processInput(content, {
        recentMessages,
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
