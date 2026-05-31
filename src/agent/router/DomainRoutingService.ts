// ============================================================
// DomainRoutingService — V3.7 P1
//
// 三段式域路由器：
//   1. ContextualPreRouter（高确定性，不调 LLM）
//   2. LLMDomainClassifier（语义分类，可禁用）
//   3. RuleDomainRouterFallback（包装现有 AgentDomainRouter）
//
// 使用方：AgentService.processInput 调用 classify(input, context)。
// ============================================================

import type { LLMClient } from "@/agent/llm/LLMClient";
import type { AgentRouteResult } from "@/agent/types";
import { AgentDomainRouter } from "@/agent/router/AgentDomainRouter";
import { ContextualPreRouter } from "@/agent/router/ContextualPreRouter";
import type { ContextualRouteOptions } from "@/agent/router/ContextualPreRouter";
import { LLMDomainClassifier } from "@/agent/router/LLMDomainClassifier";
import type { ClassifierContext } from "@/agent/router/LLMDomainClassifier";

export interface DomainRoutingContext extends ContextualRouteOptions, ClassifierContext {}

export class DomainRoutingService {
  private readonly contextualRouter: ContextualPreRouter;
  private readonly llmClassifier: LLMDomainClassifier | null;
  private readonly fallbackRouter: AgentDomainRouter;

  constructor(llmClient?: LLMClient | null) {
    this.contextualRouter = new ContextualPreRouter();
    this.fallbackRouter = new AgentDomainRouter();

    if (llmClient && llmClient.isAvailable()) {
      this.llmClassifier = new LLMDomainClassifier(llmClient);
    } else {
      this.llmClassifier = null;
    }
  }

  /**
   * 三段式分类：
   * 1. ContextualPreRouter（同步，高确定性）
   * 2. LLMDomainClassifier（异步，语义理解，可禁用）
   * 3. AgentDomainRouter fallback（规则正则）
   */
  async classify(
    rawInput: string,
    context: DomainRoutingContext = {}
  ): Promise<AgentRouteResult> {
    // ── Stage 1: Contextual ──────────────────────────────────────────────────
    const contextualResult = this.contextualRouter.classify(rawInput, context);
    if (contextualResult) {
      return contextualResult;
    }

    // ── Stage 2: LLM Classifier ──────────────────────────────────────────────
    if (this.llmClassifier?.isAvailable()) {
      try {
        const llmDecision = await this.llmClassifier.classify(rawInput, context);
        if (llmDecision) {
          return {
            domain: llmDecision.domain,
            confidence: llmDecision.confidence,
            matchedRule: "llm",
            rawInput,
            routerSource: "llm",
            llmDecision,
            subtype: llmDecision.subtype,
          };
        }
        // LLM 返回 null（验证失败 / 低置信 / 写边界违规）→ fallback
        return this.useFallback(rawInput, "llm_validation_failed");
      } catch {
        return this.useFallback(rawInput, "llm_error");
      }
    }

    // ── Stage 3: Rule Fallback ───────────────────────────────────────────────
    return this.useFallback(rawInput, this.llmClassifier === null ? "llm_disabled" : "llm_unavailable");
  }

  private useFallback(rawInput: string, reason: string): AgentRouteResult {
    const fallback = this.fallbackRouter.classify(rawInput);
    return {
      ...fallback,
      routerSource: "fallback",
      fallbackReason: reason,
    };
  }
}
