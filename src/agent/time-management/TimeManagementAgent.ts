import type { PlannerPort } from "@/agent/experience/PlannerPort";
import type { CompositePlanner } from "@/agent/CompositePlanner";
import { ContextAssembler } from "@/agent/context/ContextAssembler";
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
import { applyPastTimeDisambiguationGuard } from "@/agent/experience/pastTimeDisambiguationGuard";
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
  logRequest(
    userInput: string,
    detectedIntent?: string,
    binding?: { conversation_id?: string; turn_id?: string; message_id?: string; confirmation_id?: string }
  ): Promise<{ id: string }>;
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
    /** C4: 统一上下文包，供 LLMExperiencePlanner 使用 */
    packet?: import("@/agent/context/WorkingMemoryPacket").WorkingMemoryPacket;
  }): Promise<TimeManagementHandleResult> {
    const { userInput, context, semanticFrame, packet } = args;
    const rawPlan = await this.deps.plannerPort.plan(semanticFrame, context, packet);

    // V3.7: 所有 planner 输出都经过 PlanSafetyValidator 统一校验
    const safetyResult = this.safetyValidator.validate(rawPlan);
    if (!safetyResult.ok) {
      const log = await this.deps.logService.logRequest(userInput, semanticFrame.userGoal, {
        conversation_id: context.conversationId,
        turn_id: context.turnId,
        message_id: context.messageId,
      });
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

    // V3.8+ Guard: 保证 LLM 路径也能正确注入 Past Time Disambiguation 参数。
    // 规则路径（ActionPlanner）已设置 allowShiftToNextDay → guard 幂等跳过；
    // LLM 路径产生的 plan 缺少这些字段 → guard 从 frame 或 userInput 推断。
    if (actionPlan.kind === "request_recommendation") {
      applyPastTimeDisambiguationGuard(actionPlan.params, semanticFrame, userInput);
    }

    const toolResults: AgentToolResult[] = [];
    let queryBlocks: TimeBlock[] | undefined;
    let actionLogId: string | undefined;
    let confirmationId: string | undefined;

    const log = await this.deps.logService.logRequest(userInput, semanticFrame.userGoal, {
      conversation_id: context.conversationId,
      turn_id: context.turnId,
      message_id: context.messageId,
    });
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
          // C2/G11: 绑定会话上下文
          conversation_id: context.conversationId,
          turn_id: context.turnId,
          message_id: context.messageId,
          related_task_id: typeof actionPlan.params.taskId === "string" ? actionPlan.params.taskId : undefined,
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

      // V3.8+ Past Time Disambiguation: 读取 ActionPlanner 标注的决策参数
      const allowShiftToNextDay = Boolean(actionPlan.params.allowShiftToNextDay ?? true);
      const allowPastTime = Boolean(actionPlan.params.allowPastTime ?? false);
      const dateOffsetDays = Number(actionPlan.params.dateOffsetDays ?? 0);
      // 若用户说"明天"，推荐基准日期向后偏移 1 天
      const baseDate =
        dateOffsetDays > 0
          ? new Date(now.getTime() + dateOffsetDays * 24 * 60 * 60 * 1000)
          : now;

      const planResult = await this.recommendationPlanner.planWithMeta({
        date: baseDate,
        durationMinutes: Number.isFinite(duration) ? duration : 30,
        timezone: context.timezone,
        now,
        timeOfDay,
        allowShiftToNextDay,
        allowPastTime,
      });
      const candidates = planResult.candidates;
      // V3.8+: 记录顺延 / 追问元数据，供 composeRecommendationMessage 使用
      actionPlan.params.shiftedToNextDay = planResult.shiftedToNextDay;
      actionPlan.params.needsPastTimeClarification =
        planResult.needsPastTimeClarification ?? false;

      if (candidates.length > 0) {
        const recommendation = candidates[0];
        actionPlan.params.recommendation = recommendation;

        // V3.8+: 补记路径 → 创建历史已完成记录（initialStatus: "done"），
        // 不允许静默创建普通 scheduled 时间块
        const isBackfill = Boolean(actionPlan.params.possibleBackfill) && allowPastTime;
        const taskTitle =
          String(actionPlan.params.title ?? semanticFrame.extractedTitle ?? "新任务");
        const pending = await this.deps.confirmationService.createConfirmation({
          action_type: semanticFrame.userGoal,
          tool_name: "schedule_task",
          tool_args_json: JSON.stringify({
            title: taskTitle,
            category: actionPlan.params.category,
            duration,
            estimated_duration_minutes: duration,
            start_time: recommendation.start,
            end_time: recommendation.end,
            ...(isBackfill ? { initialStatus: "done" } : {}),
          }),
          risk_level: "low",
          description: isBackfill
            ? `补记已完成任务「${taskTitle}」（历史记录）`
            : `按推荐时间安排「${taskTitle}」`,
          // C2/G11: 绑定会话上下文 + proposal_id
          conversation_id: context.conversationId,
          turn_id: context.turnId,
          message_id: context.messageId,
        });
        confirmationId = pending.id;
      }
      await this.deps.logService.logSuccess(log.id, {
        kind: actionPlan.kind,
        recommendationCount: candidates.length,
        shiftedToNextDay: planResult.shiftedToNextDay,
        needsPastTimeClarification: planResult.needsPastTimeClarification,
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
        // C2/G11: 绑定会话上下文
        conversation_id: context.conversationId,
        turn_id: context.turnId,
        message_id: context.messageId,
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
      const timeOfDay = actionPlan.params.timeOfDay as
        | import("@/agent/experience/SemanticFrameParser").TimeOfDayRange
        | undefined;
      finalResponseMessage = this.composeRecommendationMessage(
        actionPlan.params.recommendation as { start: string; end: string } | undefined,
        context.timezone,
        {
          shiftedToNextDay: Boolean(actionPlan.params.shiftedToNextDay),
          timeOfDayLabel: timeOfDay?.label,
          needsPastTimeClarification: Boolean(
            actionPlan.params.needsPastTimeClarification
          ),
          possibleBackfill: Boolean(actionPlan.params.possibleBackfill),
        }
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
      // C4: 写入 workingMemorySnapshot 供 dev 期调试
      workingMemorySnapshot: packet
        ? ContextAssembler.toSnapshot(packet)
        : undefined,
    };

    const primaryResult = toolResults[0];
    const mappedIntent: IntentType =
      semanticFrame.userGoal === "create_and_schedule_task"
        ? "schedule_task"
        : "unknown";

    // request_recommendation：用户还未确认，resultType 应为 "pending_confirmation"
    const isRecommendationPending =
      actionPlan.kind === "request_recommendation" && !!confirmationId;

    // V3.8: 构造 pendingProposal 快照，供 chatStore 缓存并在下一轮传给路由器
    let pendingProposal: import("@/agent/types").PendingProposalSnapshot | undefined;
    if (isRecommendationPending) {
      const rec = actionPlan.params.recommendation as
        | { start: string; end: string }
        | undefined;
      if (rec && confirmationId) {
        const timeOfDay = actionPlan.params.timeOfDay as
          | import("@/agent/experience/SemanticFrameParser").TimeOfDayRange
          | undefined;
        pendingProposal = {
          confirmationId,
          kind: "recommendation",
          title: String(actionPlan.params.title ?? semanticFrame.extractedTitle ?? "新任务"),
          duration: Number(actionPlan.params.duration ?? 30),
          category: actionPlan.params.category as string | undefined,
          start: rec.start,
          end: rec.end,
          timeOfDayLabel: timeOfDay?.label,
        };
      }
    }

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
      pendingProposal,
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

  private composeRecommendationMessage(
    recommendation: { start: string; end: string } | undefined,
    timezone: string,
    meta: {
      shiftedToNextDay?: boolean;
      timeOfDayLabel?: string;
      /** V3.8+ Past Time Disambiguation: 用户说了"今天"但时段已过、非补记 */
      needsPastTimeClarification?: boolean;
      /** V3.8+ 补记模式：推荐的是今天已过的时段 */
      possibleBackfill?: boolean;
    } = {}
  ): string {
    // ── Case 1: 用户明确说了"今天"，但时段已过，且不是补记 ──────────────────
    // 不能静默给明天，需追问意图
    if (meta.needsPastTimeClarification) {
      const todPart = meta.timeOfDayLabel
        ? `今天${meta.timeOfDayLabel}`
        : "今天这个时段";
      const tomorrowPart = meta.timeOfDayLabel
        ? `明天${meta.timeOfDayLabel}`
        : "明天同一时段";
      return `${todPart}已经过去了。你是想补记${todPart}的记录，还是想把它安排到${tomorrowPart}？`;
    }

    if (!recommendation) {
      // 用户显式指定了时段但仍无候选 → 给一个更具体的解释
      if (meta.timeOfDayLabel) {
        return `${meta.timeOfDayLabel}已经过去了或没有可用时段。要不要换一个时段，比如今晚、明天${meta.timeOfDayLabel}，或者直接告诉我从几点开始？`;
      }
      return "我还需要一个更具体的时间偏好。比如今天上午、下午，或者从几点开始。";
    }

    const startStr = formatTimeInZone(recommendation.start, timezone);
    const endStr = formatTimeInZone(recommendation.end, timezone);

    // ── Case 2: 自动顺延到次日（无明确日期，时段已过） ────────────────────
    if (meta.shiftedToNextDay) {
      const todPart = meta.timeOfDayLabel ?? "";
      return `今天${todPart || "已选时段"}已经过了，我建议改到明天${todPart} ${startStr} - ${endStr}，可以吗？`;
    }

    // ── Case 3: 补记模式，推荐今天已过的时段 ─────────────────────────────
    // 明确告知将创建"已完成记录"，不允许当作普通未完成计划
    if (meta.possibleBackfill) {
      return `好的，我可以帮你补记为今天已完成的记录，时间是 ${startStr} - ${endStr}。确认后将作为已完成历史记录，是否确认？`;
    }

    // ── Case 4: 正常推荐（时段未过 / 无时段约束） ──────────────────────────
    return `我建议安排在 ${startStr} - ${endStr}，需要我按这个时间来安排吗？`;
  }
}
