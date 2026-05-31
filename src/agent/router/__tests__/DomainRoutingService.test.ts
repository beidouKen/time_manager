import { describe, expect, it, vi } from "vitest";
import { DomainRoutingService } from "@/agent/router/DomainRoutingService";
import type { LLMClient, LLMChatResponse } from "@/agent/llm/LLMClient";
import type { DomainRoutingDecision } from "@/agent/types";

// ─── MockLLMClient ────────────────────────────────────────────────────────────

function createMockLLMClient(decision: DomainRoutingDecision): LLMClient {
  return {
    isAvailable: () => true,
    getModelName: () => "mock-model",
    chat: vi.fn(async (): Promise<LLMChatResponse> => ({
      content: JSON.stringify(decision),
    })),
  };
}

function createUnavailableLLMClient(): LLMClient {
  return {
    isAvailable: () => false,
    getModelName: () => "none",
    chat: vi.fn(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DomainRoutingService", () => {
  // ── Stage 1: Contextual Pre-Router ──────────────────────────────────────

  describe("Stage 1: Contextual pre-router", () => {
    it("空输入 → low_signal（不调 LLM）", async () => {
      const mockChat = vi.fn();
      const llm: LLMClient = { isAvailable: () => true, getModelName: () => "m", chat: mockChat };
      const svc = new DomainRoutingService(llm);
      const result = await svc.classify("");
      expect(result.domain).toBe("low_signal");
      expect(result.routerSource).toBe("contextual");
      expect(mockChat).not.toHaveBeenCalled();
    });

    it("pending confirm + '好' → time_management + pendingAction.confirm（不调 LLM）", async () => {
      const mockChat = vi.fn();
      const llm: LLMClient = { isAvailable: () => true, getModelName: () => "m", chat: mockChat };
      const svc = new DomainRoutingService(llm);
      const result = await svc.classify("好", { pendingConfirmationId: "conf-xyz" });
      expect(result.domain).toBe("time_management");
      expect(result.pendingAction).toEqual({ kind: "confirm", confirmationId: "conf-xyz" });
      expect(mockChat).not.toHaveBeenCalled();
    });

    it("pending confirm + '取消' → time_management + pendingAction.reject（不调 LLM）", async () => {
      const mockChat = vi.fn();
      const llm: LLMClient = { isAvailable: () => true, getModelName: () => "m", chat: mockChat };
      const svc = new DomainRoutingService(llm);
      const result = await svc.classify("取消", { pendingConfirmationId: "conf-xyz" });
      expect(result.pendingAction?.kind).toBe("reject");
      expect(mockChat).not.toHaveBeenCalled();
    });
  });

  // ── Stage 2: LLM Classifier ──────────────────────────────────────────────

  describe("Stage 2: LLM classifier", () => {
    it("LLM 返回 assistant_meta → domain=assistant_meta, routerSource=llm", async () => {
      const decision: DomainRoutingDecision = {
        domain: "assistant_meta",
        subtype: "meta_model",
        confidence: 0.9,
        requiresWrite: false,
        reason: "询问模型信息",
      };
      const svc = new DomainRoutingService(createMockLLMClient(decision));
      const result = await svc.classify("你用的什么模型");
      expect(result.domain).toBe("assistant_meta");
      expect(result.subtype).toBe("meta_model");
      expect(result.routerSource).toBe("llm");
      expect(result.llmDecision?.subtype).toBe("meta_model");
    });

    it("LLM 返回 time_management + requiresWrite=true → time_management", async () => {
      const decision: DomainRoutingDecision = {
        domain: "time_management",
        confidence: 0.92,
        requiresWrite: true,
        reason: "创建任务",
      };
      const svc = new DomainRoutingService(createMockLLMClient(decision));
      const result = await svc.classify("帮我创建一个任务");
      expect(result.domain).toBe("time_management");
      expect(result.routerSource).toBe("llm");
    });

    it("LLM 返回 general_chat + requiresWrite=true（写边界违规）→ fallback", async () => {
      const illegalDecision: DomainRoutingDecision = {
        domain: "general_chat",
        confidence: 0.85,
        requiresWrite: true, // 非法：非 time_management 但 requiresWrite=true
        reason: "违规测试",
      };
      const svc = new DomainRoutingService(createMockLLMClient(illegalDecision));
      const result = await svc.classify("你好");
      expect(result.routerSource).toBe("fallback");
      expect(result.fallbackReason).toBe("llm_validation_failed");
    });

    it("LLM 返回低置信度（< 0.55）→ fallback", async () => {
      const lowConfidence: DomainRoutingDecision = {
        domain: "knowledge_qa",
        confidence: 0.4,
        requiresWrite: false,
        reason: "低置信",
      };
      const svc = new DomainRoutingService(createMockLLMClient(lowConfidence));
      const result = await svc.classify("为什么管理时间很重要");
      expect(result.routerSource).toBe("fallback");
    });

    it("LLM 抛出异常 → fallback", async () => {
      const llm: LLMClient = {
        isAvailable: () => true,
        getModelName: () => "m",
        chat: vi.fn(async () => { throw new Error("network error"); }),
      };
      const svc = new DomainRoutingService(llm);
      const result = await svc.classify("今天天气怎样");
      expect(result.routerSource).toBe("fallback");
      expect(result.fallbackReason).toBe("llm_error");
    });
  });

  // ── Stage 3: Rule Fallback ───────────────────────────────────────────────

  describe("Stage 3: Rule fallback（LLM 不可用）", () => {
    it("LLM disabled → routerSource=fallback, fallbackReason=llm_disabled", async () => {
      const svc = new DomainRoutingService(null);
      const result = await svc.classify("今天上海天气怎么样");
      expect(result.routerSource).toBe("fallback");
      expect(result.fallbackReason).toBe("llm_disabled");
    });

    it("LLM unavailable → routerSource=fallback", async () => {
      const svc = new DomainRoutingService(createUnavailableLLMClient());
      const result = await svc.classify("帮我写一段代码");
      expect(result.routerSource).toBe("fallback");
    });

    it("LLM disabled + 天气查询 → external_info（规则路由）", async () => {
      const svc = new DomainRoutingService(null);
      const result = await svc.classify("今天上海天气怎么样");
      expect(result.domain).toBe("external_info");
    });

    it("LLM disabled + 任务创建 → time_management（规则路由）", async () => {
      const svc = new DomainRoutingService(null);
      const result = await svc.classify("帮我安排一个写文档任务，30分钟");
      expect(result.domain).toBe("time_management");
    });

    it("LLM disabled + 纯标点 → low_signal（contextual 先命中）", async () => {
      const svc = new DomainRoutingService(null);
      const result = await svc.classify("？？");
      expect(result.domain).toBe("low_signal");
      expect(result.routerSource).toBe("contextual");
    });
  });

  // ── Read-only domains 写边界 ──────────────────────────────────────────────

  describe("只读域写边界（LLM disabled）", () => {
    it("external_info 不返回 pendingAction", async () => {
      const svc = new DomainRoutingService(null);
      const result = await svc.classify("今天有什么新闻");
      expect(result.domain).toBe("external_info");
      expect(result.pendingAction).toBeUndefined();
    });

    it("general_chat 不返回 pendingAction", async () => {
      const svc = new DomainRoutingService(null);
      const result = await svc.classify("你好");
      expect(result.pendingAction).toBeUndefined();
    });
  });
});
