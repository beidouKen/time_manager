// ============================================================
// chatStore.confirmation.test.ts — V3.7 P0-1
//
// 覆盖确认按钮残留 fix：
// 1. shouldShowConfirmationButtons 在不同 resultType 下的渲染条件
// 2. applyConfirmationPatch 把 pending 旧消息 patch 为终态、且不影响其它消息
// 3. 已经是终态的消息不被重复 patch
// 4. confirmAction / rejectAction 集成：store 内存 patch + 持久化回写
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  applyConfirmationPatch,
  shouldShowConfirmationButtons,
  useChatStore,
  type ChatMessage,
} from "@/store/chatStore";

// ─── Mock 依赖（在 chatStore 模块加载前生效）─────────────────────────────────

const mocks = vi.hoisted(() => ({
  agent: {
    confirmAction: vi.fn(),
    rejectAction: vi.fn(),
    processInput: vi.fn(),
    loadHistory: vi.fn().mockResolvedValue([]),
  },
  conv: {
    updateMessageMetadata: vi.fn().mockResolvedValue(undefined),
    createMessage: vi.fn().mockResolvedValue({}),
    loadRecent: vi.fn().mockResolvedValue([]),
    clearAll: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/agent/AgentService", () => ({
  // eslint-disable-next-line prefer-arrow-callback
  AgentService: vi.fn(function () { return mocks.agent; }),
}));

vi.mock("@/services/ConversationService", () => ({
  // eslint-disable-next-line prefer-arrow-callback
  ConversationService: vi.fn(function () { return mocks.conv; }),
}));

const baseAssistant: Omit<ChatMessage, "metadata" | "confirmationId"> = {
  id: "msg-1",
  role: "assistant",
  content: "确认要删除「写文档」吗？这个操作无法撤销。",
  timestamp: "2026-05-30T10:00:00.000Z",
};

describe("shouldShowConfirmationButtons", () => {
  it("user 消息不显示按钮", () => {
    expect(
      shouldShowConfirmationButtons({
        ...baseAssistant,
        role: "user",
        metadata: { confirmationId: "c1", resultType: "pending_confirmation" },
      })
    ).toBe(false);
  });

  it("无 confirmationId 不显示按钮", () => {
    expect(
      shouldShowConfirmationButtons({
        ...baseAssistant,
        metadata: { intent: "create_task" },
      })
    ).toBe(false);
  });

  it("有 confirmationId 且 resultType=pending_confirmation → 显示", () => {
    expect(
      shouldShowConfirmationButtons({
        ...baseAssistant,
        metadata: { confirmationId: "c1", resultType: "pending_confirmation" },
      })
    ).toBe(true);
  });

  it("有 confirmationId 且 resultType=undefined（旧数据兼容）→ 显示", () => {
    expect(
      shouldShowConfirmationButtons({
        ...baseAssistant,
        metadata: { confirmationId: "c1" },
      })
    ).toBe(true);
  });

  it("resultType=success → 不显示", () => {
    expect(
      shouldShowConfirmationButtons({
        ...baseAssistant,
        metadata: { confirmationId: "c1", resultType: "success" },
      })
    ).toBe(false);
  });

  it("resultType=failure → 不显示", () => {
    expect(
      shouldShowConfirmationButtons({
        ...baseAssistant,
        metadata: { confirmationId: "c1", resultType: "failure" },
      })
    ).toBe(false);
  });

  it("resultType=rejected → 不显示", () => {
    expect(
      shouldShowConfirmationButtons({
        ...baseAssistant,
        metadata: { confirmationId: "c1", resultType: "rejected" },
      })
    ).toBe(false);
  });

  it("旧数据顶层 confirmationId（无 metadata）也能识别为 pending", () => {
    expect(
      shouldShowConfirmationButtons({
        ...baseAssistant,
        confirmationId: "c-legacy",
      })
    ).toBe(true);
  });
});

describe("applyConfirmationPatch", () => {
  const pendingMsg: ChatMessage = {
    ...baseAssistant,
    id: "old-1",
    metadata: {
      confirmationId: "c1",
      resultType: "pending_confirmation",
      intent: "delete_task",
    },
  };

  const userMsg: ChatMessage = {
    id: "u-1",
    role: "user",
    content: "删除写文档",
    timestamp: "2026-05-30T09:59:00.000Z",
  };

  it("把 pending 旧消息 patch 为 success 终态", () => {
    const { messages, patches } = applyConfirmationPatch(
      [userMsg, pendingMsg],
      "c1",
      "success"
    );

    expect(messages[0]).toBe(userMsg); // user 消息 untouched
    expect(messages[1].metadata?.resultType).toBe("success");
    expect(messages[1].metadata?.confirmationId).toBe("c1");
    // 原 metadata.intent 应保留
    expect(messages[1].metadata?.intent).toBe("delete_task");

    // 持久化 payload
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe("old-1");
    const parsed = JSON.parse(patches[0].metadataJson);
    expect(parsed.resultType).toBe("success");
    expect(parsed.confirmationId).toBe("c1");
    expect(parsed.intent).toBe("delete_task");
  });

  it("rejected 同样能正确 patch", () => {
    const { messages, patches } = applyConfirmationPatch(
      [pendingMsg],
      "c1",
      "rejected"
    );
    expect(messages[0].metadata?.resultType).toBe("rejected");
    expect(patches).toHaveLength(1);
  });

  it("已经是终态（success）的消息不再被覆盖", () => {
    const finalized: ChatMessage = {
      ...pendingMsg,
      metadata: {
        confirmationId: "c1",
        resultType: "success",
        intent: "delete_task",
      },
    };
    const { messages, patches } = applyConfirmationPatch(
      [finalized],
      "c1",
      "rejected"
    );
    expect(messages[0]).toBe(finalized); // referential equality → 未变更
    expect(patches).toHaveLength(0);
  });

  it("不同 confirmationId 不命中", () => {
    const { messages, patches } = applyConfirmationPatch(
      [pendingMsg],
      "c2",
      "success"
    );
    expect(messages[0]).toBe(pendingMsg);
    expect(patches).toHaveLength(0);
  });

  it("命中后整体不再有任何消息会显示按钮", () => {
    const { messages } = applyConfirmationPatch([pendingMsg], "c1", "success");
    expect(messages.every((m) => !shouldShowConfirmationButtons(m))).toBe(true);
  });
});

// ─── 集成测试：confirmAction / rejectAction 全链路 ───────────────────────────

describe("confirmAction / rejectAction 集成", () => {
  const seedPendingMsg: ChatMessage = {
    id: "msg-pending-int",
    role: "assistant",
    content: "确认要删除「写文档」吗？",
    timestamp: "2026-05-30T10:00:00.000Z",
    metadata: {
      confirmationId: "c-int-1",
      resultType: "pending_confirmation",
      intent: "delete_task",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // 默认成功响应
    mocks.agent.confirmAction.mockResolvedValue({
      message: "已处理完成。",
      metadata: { resultType: "success", confirmationId: "c-int-1" },
    });
    mocks.agent.rejectAction.mockResolvedValue({
      message: "已取消。",
      metadata: { resultType: "rejected", confirmationId: "c-int-1" },
    });
    mocks.conv.updateMessageMetadata.mockResolvedValue(undefined);
    mocks.conv.createMessage.mockResolvedValue({});

    // 注入一条 pending 消息到 store
    useChatStore.setState({
      messages: [seedPendingMsg],
      isProcessing: false,
      error: null,
    });
  });

  afterEach(() => {
    // 清空 store 状态，避免测试间污染
    useChatStore.setState({ messages: [], isProcessing: false, error: null });
  });

  it("confirmAction 后旧消息 resultType patch 为 success，按钮不再显示", async () => {
    await useChatStore.getState().confirmAction("c-int-1");

    const { messages } = useChatStore.getState();
    const old = messages.find((m) => m.id === "msg-pending-int");

    expect(old).toBeDefined();
    expect(old!.metadata?.resultType).toBe("success");
    expect(shouldShowConfirmationButtons(old!)).toBe(false);
  });

  it("confirmAction 后调用 updateMessageMetadata 持久化旧消息", async () => {
    await useChatStore.getState().confirmAction("c-int-1");

    expect(mocks.conv.updateMessageMetadata).toHaveBeenCalledWith(
      "msg-pending-int",
      expect.stringContaining('"resultType":"success"')
    );
  });

  it("confirmAction 后 append 新的结果消息", async () => {
    await useChatStore.getState().confirmAction("c-int-1");

    const { messages } = useChatStore.getState();
    // 原来 1 条 + 新 1 条
    expect(messages.length).toBe(2);
    const newMsg = messages[messages.length - 1];
    expect(newMsg.content).toBe("已处理完成。");
    expect(newMsg.role).toBe("assistant");
  });

  it("rejectAction 后旧消息 resultType patch 为 rejected，按钮不再显示", async () => {
    await useChatStore.getState().rejectAction("c-int-1");

    const { messages } = useChatStore.getState();
    const old = messages.find((m) => m.id === "msg-pending-int");

    expect(old!.metadata?.resultType).toBe("rejected");
    expect(shouldShowConfirmationButtons(old!)).toBe(false);
  });

  it("agentService.confirmAction 抛错时，store.error 有值且 isProcessing=false", async () => {
    mocks.agent.confirmAction.mockRejectedValue(new Error("网络超时"));

    await useChatStore.getState().confirmAction("c-int-1");

    const { isProcessing, error } = useChatStore.getState();
    expect(isProcessing).toBe(false);
    expect(error).toContain("网络超时");
  });
});
