import type { PlannerPort } from "@/agent/experience/PlannerPort";
import type { CompositePlanner } from "@/agent/CompositePlanner";
import {
  ConversationContextBuilder,
  type ConversationMemorySnapshot,
} from "@/agent/experience/ConversationContextBuilder";
import { formatTimeInZone } from "@/agent/experience/dateFormatting";
import { ResponseBoundary } from "@/agent/experience/ResponseBoundary";
import { SemanticFrameParser } from "@/agent/experience/SemanticFrameParser";
import { ToolRouter } from "@/agent/ToolRouter";
import { AvailabilityProvider } from "@/agent/time-management/scheduling/AvailabilityProvider";
import { RecommendationPlanner } from "@/agent/time-management/scheduling/RecommendationPlanner";
import { SchedulingReasoner } from "@/agent/time-management/scheduling/SchedulingReasoner";
import { PlanSafetyValidator } from "@/agent/validators/PlanSafetyValidator";
import type {
  AgentExperienceContext,
  AgentHandlerResult,
  AgentToolResult,
  AgentTrace,
  SemanticFrame,
} from "@/agent/types";
import type { ChatMessageMetadata, IntentType } from "@/agent/types";
import { toLegacyRiskLevel } from "@/agent/types";
import type { TimeBlock } from "@/types/timeblock.types";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";
import { ConfirmationService } from "@/services/ConfirmationService";

interface ActionLogPort {
  logRequest(userInput: string, detectedIntent?: string): Promise<{ id: string }>;
  logToolExecution(
    logId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<unknown>;
  logSuccess(logId: string, result: unknown): Promise<unknown>;
  logFailure(logId: string, errorMessage: string): Promise<unknown>;
}

interface ProcessInputContext {
  recentMessages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  timezone?: string;
  currentTimelineDate?: string;
  selectedDate?: string;
  currentScreen?: string;
}

export interface TimeManagementHandleResult {
  response: AgentHandlerResult & { confirmationId?: string };
  metadata: ChatMessageMetadata;
  intent: {
    intent: IntentType;
    confidence: number;
    args: Record<string, unknown>;
    rawInput: string;
  };
}

interface TimeManagementAgentDeps {
  taskService: TaskService;
  timeBlockService: TimeBlockService;
  router: ToolRouter;
  logService: ActionLogPort;
  plannerPort: PlannerPort;
  semanticFrameParser: SemanticFrameParser;
  experienceContextBuilder: ConversationContextBuilder;
  responseBoundary: ResponseBoundary;
  confirmationService: ConfirmationService;
}

export class TimeManagementAgent {
  private recommendationPlanner: RecommendationPlanner;
  private safetyValidator: PlanSafetyValidator;

  constructor(private deps: TimeManagementAgentDeps) {
    this.recommendationPlanner = new RecommendationPlanner(
      new AvailabilityProvider(this.deps.timeBlockService),
      new SchedulingReasoner()
    );
    this.safetyValidator = new PlanSafetyValidator(this.deps.router);
  }

  buildContext(
    context: ProcessInputContext | undefined,
    memory: ConversationMemorySnapshot
  ): AgentExperienceContext {
    return this.deps.experienceContextBuilder.build(context, memory);
  }

  parse(userInput: string): SemanticFrame {
    return this.deps.semanticFrameParser.parse(userInput);
  }

  async handle(args: {
    userInput: string;
    context: AgentExperienceContext;
    semanticFrame: SemanticFrame;
  }): Promise<TimeManagementHandleResult> {
    const { userInput, context, semanticFrame } = args;
    // V3.8+: 透传 userInput 给 planner，供 RAG 上下文构建层使用
    const rawPlan = await this.deps.plannerPort.plan(semanticFrame, context, {
      userInput,
    });

    // V3.8+: 读取 planner 的 RAG 注入元数据（仅 CompositePlanner / LLMExperiencePlanner 暴露）
    const ragMeta = this.readRagMeta();

    // V3.7: 所有 planner 输出都经过 PlanSafetyValidator 统一校验
    const safetyResult = this.safetyValidator.validate(rawPlan);
    if (!safetyResult.ok) {
      const log = await this.deps.logService.logRequest(userInput, semanticFrame.userGoal);
      await this.deps.logService.logFailure(log.id, safetyResult.reason);
      const fallbackResponse = this.deps.responseBoundary.finalize({
        context,
        frame: semanticFrame,
        plan: {
          ...rawPlan,
          kind: "direct_response",
          toolName: undefined,
        },
        result: {
          domain: "time_management",
          message: "抱歉，我无法处理这个请求，请稍后再试。",
        },
      });
      const fallbackTrace: AgentTrace = {
        planner: "experience",
        domain: "time_management",
        mode: "error",
        errorKind: safetyResult.errorKind as AgentTrace["errorKind"],
        rawInput: userInput,
        contextSnapshot: context,
        semanticFrame,
        actionPlan: rawPlan,
        toolResults: [],
        finalResponse: fallbackResponse,
        planSummary: rawPlan.summary,
        ...this.spreadRagMeta(ragMeta),
      };
      return {
        response: {
          domain: "time_management",
          message: fallbackResponse,
          toolResults: [],
          metadata: { agentTrace: fallbackTrace },
        },
        metadata: {
          intent: semanticFrame.userGoal,
          resultType: "failure",
          source: "llm",
          agentTrace: fallbackTrace,
        },
        intent: {
          intent: "unknown",
          confidence: 0,
          args: rawPlan.params,
          rawInput: userInput,
        },
      };
    }

    const actionPlan = safetyResult.plan;
    const toolResults: AgentToolResult[] = [];
    let queryBlocks: TimeBlock[] | undefined;
    let actionLogId: string | undefined;
    let confirmationId: string | undefined;

    const log = await this.deps.logService.logRequest(userInput, semanticFrame.userGoal);
    actionLogId = log.id;

    if (actionPlan.kind === "tool" && actionPlan.toolName) {
      const effectiveRequiresConfirmation = actionPlan.requiresConfirmation;
      const policyRisk = actionPlan.riskLevel;

      // Confirmation gate: destructive operations require confirmation before execution
      if (effectiveRequiresConfirmation) {
        const pending = await this.deps.confirmationService.createConfirmation({
          action_type: semanticFrame.userGoal,
          tool_name: actionPlan.toolName,
          tool_args_json: JSON.stringify(actionPlan.params),
          risk_level: toLegacyRiskLevel(policyRisk),
          description: actionPlan.summary,
        });
        confirmationId = pending.id;
        await this.deps.logService.logSuccess(log.id, {
          kind: "pending_confirmation",
          confirmationId,
        });

        const finalResponse = this.deps.responseBoundary.finalize({
          context,
          frame: semanticFrame,
          plan: actionPlan,
          result: {
            domain: "time_management",
            responseKind: "confirmation_required",
          },
        });

        const trace: AgentTrace = {
          planner: "experience",
          domain: "time_management",
          mode: "clarification",
          rawInput: userInput,
          contextSnapshot: context,
          semanticFrame,
          actionPlan,
          toolResults: [],
          finalResponse,
          planSummary: actionPlan.summary,
          confirmationMetadata: {
            confirmationId,
            riskLevel: policyRisk,
            toolName: actionPlan.toolName,
          },
          ...this.spreadRagMeta(ragMeta),
        };

        const metadata: ChatMessageMetadata = {
          intent: semanticFrame.userGoal,
          toolName: actionPlan.toolName,
          actionLogId,
          confirmationId,
          resultType: "pending_confirmation",
          source: "llm",
          confidence: semanticFrame.confidence,
          llmResponseType: "clarification",
          agentTrace: trace,
        };

        return {
          response: {
            domain: "time_management",
            message: finalResponse,
            toolResults: [],
            refreshHints: undefined,
            metadata,
            confirmationId,
          },
          metadata,
          intent: {
            intent: "unknown",
            confidence: semanticFrame.confidence,
            args: actionPlan.params,
            rawInput: userInput,
          },
        };
      }

      // Normal tool execution (no confirmation required)
      await this.deps.logService.logToolExecution(
        log.id,
        actionPlan.toolName,
        actionPlan.params
      );
      const result = await this.deps.router.execute(
        actionPlan.toolName,
        actionPlan.params
      );
      toolResults.push(result);

      if (result.success) {
        await this.deps.logService.logSuccess(log.id, result.data);
      } else {
        await this.deps.logService.logFailure(log.id, result.error ?? result.message);
      }
    } else if (actionPlan.kind === "query_schedule") {
      const taskId = actionPlan.params.taskId as string | null | undefined;

      if (taskId) {
        const blocks = await this.deps.timeBlockService.getBlocksByTaskId(taskId);
        queryBlocks = blocks
          .filter((block) => !block.deleted_at)
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
      } else {
        queryBlocks = [];
      }

      const queryResult: AgentToolResult = {
        success: Boolean(taskId && queryBlocks.length > 0),
        message: "query schedule",
        data: queryBlocks,
        relatedTaskId: taskId ?? undefined,
        relatedTimeBlockId: queryBlocks[0]?.id,
      };
      toolResults.push(queryResult);
      await this.deps.logService.logSuccess(log.id, {
        taskId: taskId ?? null,
        timeBlocks: queryBlocks,
      });
    } else if (actionPlan.kind === "request_recommendation") {
      const duration = Number(actionPlan.params.duration ?? 30);
      // V3.7 P0-3：把当前时间传给 RecommendationPlanner，避免推荐 08:00 这种已过去的时间。
      const now = new Date(context.currentDatetime);
      const timeOfDay = actionPlan.params.timeOfDay as
        | import("@/agent/experience/SemanticFrameParser").TimeOfDayRange
        | undefined;
      const candidates = await this.recommendationPlanner.plan({
        date: now,
        durationMinutes: Number.isFinite(duration) ? duration : 30,
        timezone: context.timezone,
        now,
        timeOfDay,
      });
      if (candidates.length > 0) {
        const recommendation = candidates[0];
        actionPlan.params.recommendation = recommendation;
        const pending = await this.deps.confirmationService.createConfirmation({
          action_type: semanticFrame.userGoal,
          tool_name: "schedule_task",
          tool_args_json: JSON.stringify({
            title: actionPlan.params.title ?? semanticFrame.extractedTitle ?? "新任务",
            category: actionPlan.params.category,
            duration,
            estimated_duration_minutes: duration,
            start_time: recommendation.start,
            end_time: recommendation.end,
          }),
          risk_level: "low",
          description: `按推荐时间安排「${actionPlan.params.title ?? "新任务"}」`,
        });
        confirmationId = pending.id;
      }
      await this.deps.logService.logSuccess(log.id, {
        kind: actionPlan.kind,
        recommendationCount: candidates.length,
        confirmationId,
      });
    } else if (actionPlan.kind === "batch_action" || actionPlan.kind === "defer_task") {
      // V3.7: batch / defer — high risk, always requires confirmation.
      // params.actions[] 已由 PlanSafetyValidator 确认存在，序列化整个 params。
      const pending = await this.deps.confirmationService.createConfirmation({
        action_type: semanticFrame.userGoal,
        tool_name: actionPlan.kind,
        tool_args_json: JSON.stringify(actionPlan.params),
        risk_level: toLegacyRiskLevel(actionPlan.riskLevel),
        description: actionPlan.summary,
      });
      confirmationId = pending.id;
      await this.deps.logService.logSuccess(log.id, {
        kind: actionPlan.kind,
        confirmationId,
        actionsCount: Array.isArray(actionPlan.params.actions)
          ? (actionPlan.params.actions as unknown[]).length
          : 0,
      });
    } else {
      await this.deps.logService.logSuccess(log.id, {
        kind: actionPlan.kind,
        userGoal: semanticFrame.userGoal,
      });
    }

    let finalResponseMessage: string | undefined;
    let finalResponseKind: string | undefined;

    if (actionPlan.kind === "request_recommendation") {
      finalResponseKind = "clarification";
      finalResponseMessage = this.composeRecommendationMessage(
        actionPlan.params.recommendation as { start: string; end: string } | undefined,
        context.timezone
      );
    } else if (actionPlan.kind === "batch_action") {
      finalResponseMessage = `已收到批量操作请求（${actionPlan.summary}），请确认是否继续。`;
    } else if (actionPlan.kind === "defer_task") {
      const title = String(actionPlan.params.title ?? "该任务");
      const target = actionPlan.params.targetSourceText
        ? `延期到${actionPlan.params.targetSourceText}`
        : "调整时间";
      finalResponseMessage = `建议将「${title}」${target}，是否确认？`;
    }

    const finalResponse = this.deps.responseBoundary.finalize({
      context,
      frame: semanticFrame,
      plan: actionPlan,
      result: {
        domain: "time_management",
        responseKind: finalResponseKind,
        message: finalResponseMessage,
        toolResults,
        queryBlocks,
      },
    });

    const traceMode =
      actionPlan.kind === "direct_response"
        ? "direct_response"
        : actionPlan.kind === "query_schedule"
          ? "query_schedule"
          : actionPlan.kind === "chat"
            ? "chitchat"
            : actionPlan.kind === "request_recommendation"
              ? "clarification"
              : actionPlan.kind === "suggestion"
                ? "suggestion"
                : "tool_plan";

    // V3.7: 若 plannerPort 是 CompositePlanner，读取实际使用的 planner 类型
    const plannerKind = this.getPlannerKind();

    const trace: AgentTrace = {
      planner: plannerKind,
      domain: "time_management",
      mode: traceMode,
      toolName: actionPlan.toolName,
      rawInput: userInput,
      contextSnapshot: context,
      semanticFrame,
      actionPlan,
      toolResults,
      finalResponse,
      planSummary: actionPlan.summary,
      ...this.spreadRagMeta(ragMeta),
    };

    const primaryResult = toolResults[0];
    const mappedIntent: IntentType =
      semanticFrame.userGoal === "create_and_schedule_task"
        ? "schedule_task"
        : "unknown";

    // request_recommendation：用户还未确认，resultType 应为 "pending_confirmation"
    const isRecommendationPending =
      actionPlan.kind === "request_recommendation" && !!confirmationId;

    const metadata: ChatMessageMetadata = {
      intent: semanticFrame.userGoal,
      toolName: actionPlan.toolName,
      actionLogId,
      confirmationId,
      relatedTaskId:
        primaryResult?.relatedTaskId ??
        (actionPlan.params.taskId as string | undefined),
      relatedTimeBlockId: primaryResult?.relatedTimeBlockId,
      resultType: isRecommendationPending
        ? "pending_confirmation"
        : primaryResult && !primaryResult.success
          ? "failure"
          : "success",
      source: "llm",
      confidence: semanticFrame.confidence,
      llmResponseType: traceMode === "chitchat" ? "chitchat" : traceMode === "clarification" ? "clarification" : "tool_plan",
      agentTrace: trace,
    };

    return {
      response: {
        domain: "time_management",
        message: finalResponse,
        toolResults,
        queryBlocks,
        refreshHints: actionPlan.refreshHints,
        metadata,
        confirmationId,
      },
      metadata,
      intent: {
        intent: mappedIntent,
        confidence: semanticFrame.confidence,
        args: actionPlan.params,
        rawInput: userInput,
      },
    };
  }

  private getPlannerKind(): AgentTrace["planner"] {
    const composite = this.deps.plannerPort as Partial<CompositePlanner>;
    if (typeof composite.lastUsedPlanner === "string") {
      return composite.lastUsedPlanner === "llm" ? "llm" : "experience";
    }
    return "experience";
  }

  /**
   * V3.8+: 从 plannerPort 读取本次 plan 的 RAG 注入元数据。
   *
   * 防御性读取：
   * - StubPlanner / 自定义实现没有 lastRagMeta → 返回 undefined。
   * - 注入失败 / 无命中 → planner 内部已置为 { injected: false, snippetCount: 0 }。
   */
  private readRagMeta():
    | { injected: boolean; snippetCount: number; query?: string }
    | undefined {
    const planner = this.deps.plannerPort as Partial<{
      lastRagMeta: { injected: boolean; snippetCount: number; query?: string };
    }>;
    return planner.lastRagMeta;
  }

  /**
   * V3.8+: 把 RAG meta 展开为 AgentTrace 可选字段。
   * 无注入信号时返回空对象，避免污染 trace。
   */
  private spreadRagMeta(
    meta: ReturnType<TimeManagementAgent["readRagMeta"]>
  ): Pick<AgentTrace, "ragContextInjected" | "ragSnippetCount" | "ragQuery"> {
    if (!meta) return {};
    return {
      ragContextInjected: meta.injected,
      ragSnippetCount: meta.snippetCount,
      ragQuery: meta.query,
    };
  }

  private composeRecommendationMessage(
    recommendation: { start: string; end: string } | undefined,
    timezone: string
  ): string {
    if (!recommendation) {
      return "我还需要一个更具体的时间偏好。比如今天上午、下午，或者从几点开始。";
    }
    const startStr = formatTimeInZone(recommendation.start, timezone);
    const endStr = formatTimeInZone(recommendation.end, timezone);
    return `我建议安排在 ${startStr} - ${endStr}，需要我按这个时间来安排吗？`;
  }
}
