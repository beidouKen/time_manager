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
import { PendingProposalInterpreter } from "@/agent/router/PendingProposalInterpreter";
import { ActiveContextResolver } from "@/agent/router/ActiveContextResolver";
import type { ActiveContextService } from "@/services/ActiveContextService";
import type { ConfirmationService } from "@/services/ConfirmationService";
import type { WorkingMemoryPacket } from "@/agent/context/WorkingMemoryPacket";

export interface DomainRoutingContext extends ContextualRouteOptions, ClassifierContext {
  // V3.8: pendingProposal 字段定义在 ContextualRouteOptions 上（Stage 1 也要看），
  // 这里通过 extends 自动透传。
  /** 当前时间 ISO（透传给 PendingProposalInterpreter 做 anchorTime 转换） */
  currentDatetime?: string;
  /** C3: 会话 ID，Stage 0 ActiveContextResolver 使用 */
  conversationId?: string;
}

export class DomainRoutingService {
  private readonly contextualRouter: ContextualPreRouter;
  private readonly proposalInterpreter: PendingProposalInterpreter;
  private readonly llmClassifier: LLMDomainClassifier | null;
  private readonly fallbackRouter: AgentDomainRouter;
  private readonly activeContextResolver: ActiveContextResolver;

  /** C3: 可选注入，未注入则跳过 Stage 0 */
  private readonly activeContextService: ActiveContextService | null;
  private readonly confirmationService: ConfirmationService | null;

  constructor(
    llmClient?: LLMClient | null,
    activeContextService?: ActiveContextService | null,
    confirmationService?: ConfirmationService | null,
  ) {
    this.contextualRouter = new ContextualPreRouter();
    this.proposalInterpreter = new PendingProposalInterpreter(llmClient ?? null);
    this.fallbackRouter = new AgentDomainRouter();
    this.activeContextResolver = new ActiveContextResolver();
    this.activeContextService = activeContextService ?? null;
    this.confirmationService = confirmationService ?? null;

    if (llmClient && llmClient.isAvailable()) {
      this.llmClassifier = new LLMDomainClassifier(llmClient);
    } else {
      this.llmClassifier = null;
    }
  }

  /**
   * 五段式分类（C3 新增 Stage 0）：
   * 0. ActiveContextResolver（Stage 0，DB-active 恢复 pendingProposal / pendingConfirmationId）
   * 1. ContextualPreRouter（同步，高确定性：noise / 精确 confirm / reject）
   * 2. PendingProposalInterpreter（异步，仅当存在 recommendation 类提案）
   * 3. LLMDomainClassifier（异步，通用语义理解，可禁用）
   * 4. AgentDomainRouter fallback（规则正则）
   * C4: 可传入 WorkingMemoryPacket 供 Stage 2/3 LLM 入口使用。
   */
  async classify(
    rawInput: string,
    context: DomainRoutingContext = {},
    packet?: WorkingMemoryPacket
  ): Promise<AgentRouteResult> {
    // ── Stage 0: ActiveContextResolver（C3） ─────────────────────────────────
    if (this.activeContextService && context.conversationId) {
      try {
        const hint = await this.activeContextResolver.resolve({
          conversationId: context.conversationId,
          rawInput,
          currentDatetime: context.currentDatetime,
          confirmationService: this.confirmationService ?? undefined,
          activeContextService: this.activeContextService,
        });

        if (hint.status !== "no_active_context") {
          // DB-active 优先于 chatStore 内存传入（??= 语义）
          if (hint.pendingConfirmationId && !context.pendingConfirmationId) {
            context = { ...context, pendingConfirmationId: hint.pendingConfirmationId };
          }
          if (hint.pendingProposal && !context.pendingProposal) {
            context = { ...context, pendingProposal: hint.pendingProposal };
          }
        }
        // hint.recommendedRoute 可用于 trace（上层 AgentService 读取）
      } catch {
        // Stage 0 异常静默穿透，不影响主流程
      }
    }

    // ── Stage 1: Contextual ──────────────────────────────────────────────────
    const contextualResult = this.contextualRouter.classify(rawInput, context);
    if (contextualResult) {
      return contextualResult;
    }

    // ── Stage 2: PendingProposalInterpreter ──────────────────────────────────
    // 仅当存在 recommendation 类提案时介入，topic_change 或 null 穿透到 Stage 3。
    if (context.pendingProposal?.kind === "recommendation") {
      const proposal = context.pendingProposal;
      try {
        const decision = await this.proposalInterpreter.interpret(
          rawInput,
          proposal,
          {
            timezone: context.timezone,
            currentDatetime: context.currentDatetime,
            packet,
          }
        );

        if (decision && decision.intent !== "topic_change") {
          const routeBase: AgentRouteResult = {
            domain: "time_management",
            confidence: decision.confidence,
            matchedRule: `proposal_interpreter:${decision.intent}`,
            rawInput,
            routerSource: "contextual",
          };

          if (decision.intent === "confirm") {
            return {
              ...routeBase,
              pendingAction: { kind: "confirm", confirmationId: proposal.confirmationId },
            };
          }
          if (decision.intent === "reject") {
            return {
              ...routeBase,
              pendingAction: { kind: "reject", confirmationId: proposal.confirmationId },
            };
          }
          if (decision.intent === "refine") {
            return {
              ...routeBase,
              pendingAction: {
                kind: "refine",
                confirmationId: proposal.confirmationId,
                refinements: decision.refinements,
              },
            };
          }
        }
      } catch {
        // 解释器异常 → 静默穿透到 Stage 3
      }
    }

    // ── Stage 3: LLM Classifier ──────────────────────────────────────────────
    if (this.llmClassifier?.isAvailable()) {
      try {
        const llmDecision = await this.llmClassifier.classify(rawInput, context, packet);
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

    // ── Stage 4: Rule Fallback ───────────────────────────────────────────────
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
