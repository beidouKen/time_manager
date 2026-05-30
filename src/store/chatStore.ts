import { create } from "zustand";
import { AgentService } from "@/agent/AgentService";
import type { AgentResponse } from "@/agent/AgentService";
import { SqliteConversationRepository } from "@/repositories/sqlite/SqliteConversationRepository";
import type { ConversationMessage } from "@/types/agent.types";
import { OpenCliCodegenService } from "@/plugins/opencli-codegen";
import { WeChatContextTestService, WeComContextWorkflowService } from "@/plugins/external-context";

const agentService = new AgentService();
const conversationRepo = new SqliteConversationRepository();
const openCliCodegenService = new OpenCliCodegenService();
const weChatContextTestService = new WeChatContextTestService();
const weComContextWorkflowService = new WeComContextWorkflowService();

export type ChatMode = "agent" | "parse_link" | "wechat_context" | "wecom_context";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  confirmationId?: string;
  timestamp: string;
}

interface ChatState {
  messages: ChatMessage[];
  isProcessing: boolean;
  error: string | null;
}

interface ChatActions {
  sendMessage: (content: string, mode?: ChatMode) => Promise<void>;
  confirmAction: (confirmationId: string) => Promise<void>;
  rejectAction: (confirmationId: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
}

export const useChatStore = create<ChatState & ChatActions>((set, _get) => ({
  messages: [],
  isProcessing: false,
  error: null,

  loadHistory: async () => {
    try {
      const history = await conversationRepo.findRecent(50);
      const messages: ChatMessage[] = history.map((m: ConversationMessage) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        confirmationId: m.metadata_json
          ? (JSON.parse(m.metadata_json) as Record<string, string>).confirmationId
          : undefined,
        timestamp: m.created_at,
      }));
      set({ messages });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  sendMessage: async (content: string, mode = "agent") => {
    set({ isProcessing: true, error: null });

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    set((s) => ({ messages: [...s.messages, userMsg] }));

    await conversationRepo.create({
      role: "user",
      content,
    });

    try {
      const response: AgentResponse =
        mode === "parse_link"
          ? {
              message: await openCliCodegenService.generateMessage(content),
              intent: {
                intent: "unknown",
                confidence: 1,
                args: { mode },
                rawInput: content,
              },
            }
          : mode === "wechat_context"
            ? {
                message: await weChatContextTestService.generateMessage(content),
                intent: {
                  intent: "unknown",
                  confidence: 1,
                  args: { mode },
                  rawInput: content,
                },
              }
          : mode === "wecom_context"
            ? {
                message: await weComContextWorkflowService.generateMessage(content),
                intent: {
                  intent: "unknown",
                  confidence: 1,
                  args: { mode },
                  rawInput: content,
                },
              }
          : await agentService.processInput(content);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.message,
        confirmationId: response.confirmationId,
        timestamp: new Date().toISOString(),
      };

      set((s) => ({
        messages: [...s.messages, assistantMsg],
        isProcessing: false,
      }));

      await conversationRepo.create({
        role: "assistant",
        content: response.message,
        metadata_json: response.confirmationId
          ? JSON.stringify({ confirmationId: response.confirmationId })
          : undefined,
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
        timestamp: new Date().toISOString(),
      };

      set((s) => ({
        messages: [...s.messages, msg],
        isProcessing: false,
      }));

      await conversationRepo.create({
        role: "assistant",
        content: response.message,
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
        timestamp: new Date().toISOString(),
      };

      set((s) => ({
        messages: [...s.messages, msg],
        isProcessing: false,
      }));

      await conversationRepo.create({
        role: "assistant",
        content: response.message,
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
