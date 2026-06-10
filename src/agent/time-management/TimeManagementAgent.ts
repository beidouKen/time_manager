import type { PlannerPort } from "@/agent/experience/PlannerPort";
import type { CompositePlanner } from "@/agent/CompositePlanner";
import { ContextAssembler } from "@/agent/context/ContextAssembler";
import { RecentActionReader } from "@/agent/recent-action/RecentActionReader";
import {
  ConversationContextBuilder,
  type ConversationMemorySnapshot,
} from "@/agent/experience/ConversationContextBuilder";
import { formatTimeInZone } from "@/agent/experience/dateFormatting";
import { ResponseBoundary } from "@/agent/experience/ResponseBoundary";
import { SemanticFrameParser } from "@/agent/experience/SemanticFrameParser";
import { getSemanticDisplayNoun } from "@/agent/experience/semanticDisplay";
import { ToolRouter } from "@/agent/ToolRouter";
import { TaskReadModelService } from "@/agent/read-model/TaskReadModelService";
import { AvailabilityProvider } from "@/agent/time-management/scheduling/AvailabilityProvider";
import { RecommendationPlanner } from "@/agent/time-management/scheduling/RecommendationPlanner";
import { SchedulingReasoner } from "@/agent/time-management/scheduling/SchedulingReasoner";
import { PlanSafetyValidator } from "@/agent/validators/PlanSafetyValidator";
import { applyPastTimeDisambiguationGuard } from "@/agent/experience/pastTimeDisambiguationGuard";
import type {
  GuardrailRunReport,
} from "@/agent/guardrails";
import {
  formatGuardrailEvidenceForTrace,
  GuardrailRunner,
} from "@/agent/guardrails";
import type {
  AgentExperienceContext,
  AgentHandlerResult,
  AgentToolResult,
  AgentTrace,
  EventSubKind,
  ExperienceActionPlan,
  SemanticFrame,
  SemanticType,
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
  taskReadModelService: TaskReadModelService;
  router: ToolRouter;
  logService: ActionLogPort;
  plannerPort: PlannerPort;
  semanticFrameParser: SemanticFrameParser;
  experienceContextBuilder: ConversationContextBuilder;
  responseBoundary: ResponseBoundary;
  confirmationService: ConfirmationService;
  guardrailRunner: GuardrailRunner;
  // V3.9.0 TEMP BRIDGE — needed by RecentActionReader (B2)
  contextTraceService?: import("@/services/ContextTraceService").ContextTraceService | null;
  semanticEventService?: import("@/services/SemanticEventService").SemanticEventService | null;
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
    const prePlanReport = await this.deps.guardrailRunner.runAll("pre_plan", {
      stage: "pre_plan",
      now: new Date(context.currentDatetime),
      conversationId: context.conversationId,
      turnId: context.turnId,
      messageId: context.messageId,
      userInput,
      workingMemoryPacket: packet,
      semanticFrame,
      experienceContext: context,
      routeDomain: "time_management",
    });
    await this.recordGuardrailTrace(prePlanReport, context);
    if (prePlanReport.finalDecision !== "allow") {
      return this.createEarlyGuardrailResponse(prePlanReport, {
        context,
        semanticFrame,
        userInput,
      });
    }

    const rawPlan = await this.deps.plannerPort.plan(semanticFrame, context, packet);
    this.enrichSemanticParams(rawPlan, semanticFrame);
    const postPlanReport = await this.deps.guardrailRunner.runAll("post_plan", {
      stage: "post_plan",
      now: new Date(context.currentDatetime),
      conversationId: context.conversationId,
      turnId: context.turnId,
      messageId: context.messageId,
      userInput,
      workingMemoryPacket: packet,
      semanticFrame,
      experienceContext: context,
      routeDomain: "time_management",
      rawPlan,
    });
    await this.recordGuardrailTrace(postPlanReport, context);
    if (postPlanReport.finalDecision !== "allow") {
      return this.createEarlyGuardrailResponse(postPlanReport, {
        context,
        semanticFrame,
        userInput,
        plan: rawPlan,
      });
    }

    // V3.7: 所有 planner 输出都经过 PlanSafetyValidator 统一校验
    const safetyResult = this.safetyValidator.validate(rawPlan);
    if (!safetyResult.ok) {
      const log = await this.deps.logService.logRequest(userInput, semanticFrame.userGoal, {
        conversation_id: context.conversationId,
        turn_id: context.turnId,
        message_id: context.messageId,
      });
      await this.deps.logService.logFailure(log.id, safetyResult.reason);
      const fallbackRendered = this.deps.responseBoundary.finalizeRich({
        context,
        frame: semanticFrame,
        plan: {
          ...rawPlan,
          kind: "direct_response",
          toolName: undefined,
        },
        result: {
          domain: "time_management",
          responseKind: "error",
          message: "抱歉，我无法处理这个请求，请稍后再试。",
        },
      });
      const fallbackResponse = fallbackRendered.message;
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
          metadata: {
            agentTrace: fallbackTrace,
            responseKind: fallbackRendered.responseKind,
            responseBranch: fallbackRendered.responseBranch,
            genericFallbackUsed: fallbackRendered.genericFallbackUsed,
          },
        },
        metadata: {
          intent: semanticFrame.userGoal,
          resultType: "failure",
          source: "llm",
          agentTrace: fallbackTrace,
          responseKind: fallbackRendered.responseKind,
          responseBranch: fallbackRendered.responseBranch,
          genericFallbackUsed: fallbackRendered.genericFallbackUsed,
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
      const guardrailReport = await this.runPreToolGuardrails({
        plan: actionPlan,
        toolName: actionPlan.toolName,
        toolParams: actionPlan.params,
        context,
        semanticFrame,
        userInput,
        packet,
      });

      if (guardrailReport.finalDecision === "block") {
        const lastGuardrailResult =
          guardrailReport.results[guardrailReport.results.length - 1];
        const reason =
          lastGuardrailResult?.reason ??
          "guardrail_blocked";
        await this.deps.logService.logFailure(log.id, reason);

        const blockedResult = guardrailReport.results.find(
          (result) => result.decision === "block"
        );
        const rendered = this.deps.responseBoundary.finalizeRich({
          context,
          frame: semanticFrame,
          plan: actionPlan,
          result: {
            domain: "time_management",
            responseKind: "blocked",
            blocked: {
              guardrailName:
                blockedResult?.name ?? "ToolPermissionGuardrail",
              reason: blockedResult?.reason,
              nextStep: "重新描述具体对象、范围或时间后再试",
            },
          },
        });
        const finalResponse = rendered.message;
        const trace: AgentTrace = {
          planner: this.getPlannerKind(),
          domain: "time_management",
          mode: "error",
          errorKind: "invalid_tool",
          rawInput: userInput,
          contextSnapshot: context,
          semanticFrame,
          actionPlan,
          toolResults: [],
          finalResponse,
          planSummary: actionPlan.summary,
        };
        const metadata: ChatMessageMetadata = {
          intent: semanticFrame.userGoal,
          toolName: actionPlan.toolName,
          actionLogId,
          resultType: "failure",
          source: "llm",
          confidence: semanticFrame.confidence,
          agentTrace: trace,
          responseKind: rendered.responseKind,
          responseBranch: rendered.responseBranch,
          genericFallbackUsed: rendered.genericFallbackUsed,
        };

        return {
          response: {
            domain: "time_management",
            message: finalResponse,
            toolResults: [],
            metadata,
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

      if (guardrailReport.finalDecision === "ask_clarification") {
        return this.createGuardrailClarificationResponse(actionPlan, {
          context,
          semanticFrame,
          userInput,
          actionLogId: log.id,
        });
      }

      if (guardrailReport.finalDecision === "ask_confirmation") {
        return this._createConfirmationFromGuardrailDecision(
          actionPlan,
          guardrailReport,
          {
            context,
            semanticFrame,
            userInput,
            actionLogId: log.id,
          }
        );
      }

      // Keep the existing plan-level confirmation gate as a fallback.
      if (actionPlan.requiresConfirmation) {
        return this.createPendingConfirmationResponse(actionPlan, {
          context,
          semanticFrame,
          userInput,
          actionLogId: log.id,
          source: "plan_fallback",
        });
      }

      await this.deps.logService.logToolExecution(
        log.id,
        actionPlan.toolName,
        actionPlan.params
      );
      const result = await this.deps.router.execute(
        actionPlan.toolName,
        actionPlan.params
      );
      const routerFallback =
        await this._resolveToolRouterConfirmationFallback(
          result,
          actionPlan,
          context,
          {
            semanticFrame,
            userInput,
            actionLogId: log.id,
          }
        );
      if (routerFallback) {
        return routerFallback;
      }
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
      const allowShiftToNextDay = Boolean(actionPlan.params.allowShiftToNextDay ?? false);
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
    } else if (actionPlan.kind === "query_tasks") {
      const guardrailReport = await this.runPreToolGuardrails({
        plan: actionPlan,
        toolName: "list_tasks",
        toolParams: actionPlan.params,
        context,
        semanticFrame,
        userInput,
        packet,
      });
      if (guardrailReport.finalDecision !== "allow") {
        return this.createEarlyGuardrailResponse(guardrailReport, {
          context,
          semanticFrame,
          userInput,
          plan: actionPlan,
        });
      }

      // V3.9.0 TEMP BRIDGE — B1: filter to unscheduled tasks only (read-only path).
      // A task is "unscheduled" when it is todo AND has no TimeBlock associated.
      try {
        const unscheduledTasks =
          await this.deps.taskReadModelService.getUnscheduledTasks();
        const queryResult: AgentToolResult = {
          success: true,
          message: "query_tasks",
          data: unscheduledTasks,
        };
        toolResults.push(queryResult);
        await this.deps.logService.logSuccess(log.id, {
          taskCount: unscheduledTasks.length,
        });
      } catch (e) {
        await this.deps.logService.logFailure(log.id, String(e));
      }
    } else if (actionPlan.kind === "batch_action" || actionPlan.kind === "defer_task") {
      const actions = actionPlan.params.actions as
        | Array<{ toolName: string; params: Record<string, unknown> }>
        | undefined;
      const representativeAction = actions?.[0];
      if (representativeAction) {
        const guardrailReport = await this.runPreToolGuardrails({
          plan: actionPlan,
          toolName: representativeAction.toolName,
          toolParams: {
            ...representativeAction.params,
            actions,
          },
          context,
          semanticFrame,
          userInput,
          packet,
        });
        if (
          guardrailReport.finalDecision === "block" ||
          guardrailReport.finalDecision === "ask_clarification"
        ) {
          return this.createEarlyGuardrailResponse(guardrailReport, {
            context,
            semanticFrame,
            userInput,
            plan: actionPlan,
          });
        }
      }

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
    let responseQueryTasks:
      | Array<{ title: string; status: string }>
      | undefined;
    let responseRecentActions:
      | Array<{ summary: string; source: string }>
      | undefined;

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
          isExplicitToday: Boolean(actionPlan.params.isExplicitToday),
        }
      );
    } else if (actionPlan.kind === "query_schedule") {
      finalResponseKind = "query_result";
      const block = queryBlocks?.[0];
      if (!actionPlan.params.taskId) {
        finalResponseMessage =
          "我还不知道你指的是哪个任务。可以告诉我任务名称吗？";
      } else if (!block) {
        finalResponseMessage = "我还没有找到这个任务的时间安排。";
      } else {
        finalResponseMessage =
          `这个任务安排在 ${formatTimeInZone(block.start_time, context.timezone)}` +
          ` - ${formatTimeInZone(block.end_time, context.timezone)}。`;
      }
    } else if (actionPlan.kind === "query_tasks") {
      // V3.9.0 TEMP BRIDGE — B1: render unscheduled task list with "query_result" kind.
      finalResponseKind = "query_result";
      const tasks = toolResults[0]?.data as Array<{ title: string; status: string }> | undefined;
      responseQueryTasks = tasks;
      if (!tasks || tasks.length === 0) {
        finalResponseMessage = "目前没有未安排的任务。";
      } else {
        const list = tasks.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
        finalResponseMessage = `还没安排的任务有：\n${list}`;
      }
    } else if (actionPlan.params.adviceRequested) {
      // V4.1+: 时间管理建议（request_advice 意图，direct_response 路径）
      finalResponseMessage =
        "时间管理建议：\n" +
        "1. 使用番茄工作法（25 分钟专注 + 5 分钟休息），把大任务分成可执行的小块。\n" +
        "2. 优先处理截止日期最近或影响最大的任务（艾森豪威尔矩阵：重要且紧急优先）。\n" +
        "3. 在精力最充沛的时段（通常是上午）处理需要深度思考的任务。\n" +
        "4. 将类似性质的小任务集中处理，减少上下文切换成本。\n" +
        "5. 每天结束前回顾完成情况，为次日做好规划。\n" +
        "\n如需我帮你把某个任务安排进时间轴，直接告诉我任务名称和时间即可。";
    } else if (actionPlan.params.isRecentActionQuery) {
      // V3.9.0 TEMP BRIDGE — B2: recent action query path.
      // Use RecentActionReader (trace-first). Never fall back to identity text.
      finalResponseKind = "recent_action";
      const reader = new RecentActionReader(
        this.deps.contextTraceService,
        this.deps.semanticEventService,
      );
      const recentActions = context.conversationId
        ? await reader.getRecentActions(context.conversationId, 3)
        : [];
      responseRecentActions = recentActions;
      if (recentActions.length === 0) {
        finalResponseMessage = "暂时没有最近动作记录。等你做点什么之后我再帮你回顾。";
      } else {
        const list = recentActions.map((a, i) => `${i + 1}. ${a.summary}`).join("\n");
        finalResponseMessage = `刚才我做了：\n${list}`;
      }
    } else if (actionPlan.params.taskNotFound) {
      // V4.2+: mark_task_completed / defer_task 找不到任务
      const keyword = String(actionPlan.params.keyword ?? "该任务");
      finalResponseMessage = `未找到任务「${keyword}」，请告诉我具体的任务名称或重新选择。`;
    } else if (actionPlan.params.noMatch) {
      // B9: 批量操作没有匹配项
      finalResponseMessage = String(actionPlan.params.noMatchText ?? "未找到匹配的任务，无需操作。");
    } else if (actionPlan.kind === "batch_action") {
      finalResponseMessage = `已收到批量操作请求（${actionPlan.summary}），请确认是否继续。`;
    } else if (actionPlan.kind === "defer_task") {
      const title = String(actionPlan.params.title ?? "该任务");
      const target = actionPlan.params.targetSourceText
        ? `延期到${actionPlan.params.targetSourceText}`
        : "调整时间";
      finalResponseMessage = `建议将「${title}」${target}，是否确认？`;
    } else if (actionPlan.kind === "clarification_past_time") {
      // V3.9.0 TEMP BRIDGE — B3: past absolute time → ask user, do NOT write data.
      finalResponseKind = "clarification_past_time";
      const timeLabel = String(
        actionPlan.params.originalTimeLabel ?? actionPlan.params.originalTimeIso ?? "那个时间"
      );
      const noun = getSemanticDisplayNoun(actionPlan.params);
      finalResponseMessage =
        `你说的${timeLabel}已经过去了。你想把这个${noun}改到明天同一时间，还是今天的某个未来时间？`;
    }

    const renderedResponse = this.deps.responseBoundary.finalizeRich({
      context,
      frame: semanticFrame,
      plan: actionPlan,
      result: {
        domain: "time_management",
        responseKind: finalResponseKind,
        message: finalResponseMessage,
        toolResults,
        queryBlocks,
        queryTasks: responseQueryTasks,
        recentActions: responseRecentActions,
      },
    });
    const finalResponse = renderedResponse.message;

    const traceMode =
      actionPlan.kind === "direct_response"
        ? "direct_response"
        : actionPlan.kind === "query_schedule" || actionPlan.kind === "query_tasks"
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

    const needsPastTimeClarification = Boolean(
      actionPlan.params.needsPastTimeClarification
    );

    // semanticType comes from frame constraints (set by SemanticFrameParser or ActionPlanner)
    const frameSematicType = semanticFrame.constraints?.semanticType as ChatMessageMetadata["semanticType"] | undefined;
    const planSemanticType = actionPlan.params.semanticType as ChatMessageMetadata["semanticType"] | undefined;
    const resolvedSemanticType = frameSematicType ?? planSemanticType;

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
      responseKind: renderedResponse.responseKind,
      responseBranch: renderedResponse.responseBranch,
      genericFallbackUsed: renderedResponse.genericFallbackUsed,
      semanticType: resolvedSemanticType,
      ...(needsPastTimeClarification
        ? {
            quickActions: [
              "backfill_today",
              "schedule_tomorrow",
              "schedule_other_day",
              "cancel",
            ] as const,
          }
        : {}),
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

  private enrichSemanticParams(
    plan: ExperienceActionPlan,
    frame: SemanticFrame
  ): void {
    const ruleType = frame.constraints.semanticType;
    const llmType = this.isSemanticType(plan.params.semanticType)
      ? plan.params.semanticType
      : undefined;

    if (ruleType && ruleType !== "task") {
      plan.params.semanticType = ruleType;
      plan.params.semanticTypeSource = "rule";
      if (ruleType === "event" && frame.constraints.eventSubKind) {
        plan.params.eventSubKind = frame.constraints.eventSubKind;
      } else {
        delete plan.params.eventSubKind;
      }
      return;
    }

    if (llmType) {
      plan.params.semanticType = llmType;
      plan.params.semanticTypeSource = "llm_fallback";
      if (
        llmType !== "event" ||
        !this.isEventSubKind(plan.params.eventSubKind)
      ) {
        delete plan.params.eventSubKind;
      }
      return;
    }

    plan.params.semanticType = ruleType ?? "task";
    plan.params.semanticTypeSource = "rule";
    delete plan.params.eventSubKind;
  }

  private isSemanticType(value: unknown): value is SemanticType {
    return (
      value === "task" ||
      value === "event" ||
      value === "activity" ||
      value === "routine_candidate"
    );
  }

  private isEventSubKind(value: unknown): value is EventSubKind {
    return value === "lesson" || value === "meeting" || value === "general";
  }

  private async _createConfirmationFromGuardrailDecision(
    plan: ExperienceActionPlan,
    report: GuardrailRunReport,
    execution: {
      context: AgentExperienceContext;
      semanticFrame: SemanticFrame;
      userInput: string;
      actionLogId: string;
    }
  ): Promise<TimeManagementHandleResult> {
    if (!plan.toolName) {
      throw new Error("Cannot create confirmation without toolName");
    }
    const confirmationResult = report.results.find(
      (result) => result.decision === "ask_confirmation"
    );
    return this.createPendingConfirmationResponse(plan, {
      ...execution,
      source: confirmationResult?.name ?? "guardrail",
    });
  }

  private async runPreToolGuardrails(args: {
    plan: ExperienceActionPlan;
    toolName: string;
    toolParams: Record<string, unknown>;
    context: AgentExperienceContext;
    semanticFrame: SemanticFrame;
    userInput: string;
    packet?: import("@/agent/context/WorkingMemoryPacket").WorkingMemoryPacket;
  }): Promise<GuardrailRunReport> {
    const report = await this.deps.guardrailRunner.runAll("pre_tool", {
      stage: "pre_tool",
      now: new Date(args.context.currentDatetime),
      conversationId: args.context.conversationId,
      turnId: args.context.turnId,
      messageId: args.context.messageId,
      userInput: args.userInput,
      workingMemoryPacket: args.packet,
      semanticFrame: args.semanticFrame,
      experienceContext: args.context,
      routeDomain: "time_management",
      plan: args.plan,
      toolName: args.toolName,
      toolParams: args.toolParams,
      toolManifest: this.deps.router.getManifest(args.toolName),
      currentSkill: "time_management",
    });
    await this.recordGuardrailTrace(report, args.context);
    return report;
  }

  private async createEarlyGuardrailResponse(
    report: GuardrailRunReport,
    args: {
      context: AgentExperienceContext;
      semanticFrame: SemanticFrame;
      userInput: string;
      plan?: ExperienceActionPlan;
    }
  ): Promise<TimeManagementHandleResult> {
    const { context, semanticFrame, userInput } = args;
    const plan: ExperienceActionPlan = args.plan ?? {
      id: crypto.randomUUID(),
      kind: "direct_response",
      userGoal: semanticFrame.userGoal,
      params: {},
      requiresConfirmation: false,
      riskLevel: "safe",
      summary: `${report.stage} guardrail response`,
      createdAt: new Date(context.currentDatetime).toISOString(),
    };
    const log = await this.deps.logService.logRequest(
      userInput,
      semanticFrame.userGoal,
      {
        conversation_id: context.conversationId,
        turn_id: context.turnId,
        message_id: context.messageId,
      }
    );
    const isBlock = report.finalDecision === "block";
    const blocker = report.results.find(
      (result) => result.decision === "block"
    );
    const rendered = this.deps.responseBoundary.finalizeRich({
      context,
      frame: semanticFrame,
      plan,
      result: isBlock
        ? {
            domain: "time_management",
            responseKind: "blocked",
            blocked: {
              guardrailName:
                blocker?.name ?? report.firstBlocker ?? "PlanSchemaGuardrail",
              nextStep: "补充具体对象或范围后再试",
            },
          }
        : {
            domain: "time_management",
            responseKind: "clarification",
            message: "我还不能安全确认你的操作意图，请补充具体对象或范围。",
          },
    });
    const message = rendered.message;
    if (isBlock) {
      await this.deps.logService.logFailure(
        log.id,
        report.results[report.results.length - 1]?.reason ??
          "guardrail_blocked"
      );
    } else {
      await this.deps.logService.logSuccess(log.id, {
        kind: "guardrail_clarification",
        stage: report.stage,
      });
    }

    const trace: AgentTrace = {
      planner: this.getPlannerKind(),
      domain: "time_management",
      mode: isBlock ? "error" : "clarification",
      errorKind: isBlock ? "invalid_tool" : undefined,
      rawInput: userInput,
      contextSnapshot: context,
      semanticFrame,
      actionPlan: plan,
      toolResults: [],
      finalResponse: message,
      planSummary: plan.summary,
    };
    const metadata: ChatMessageMetadata = {
      intent: semanticFrame.userGoal,
      actionLogId: log.id,
      resultType: isBlock ? "failure" : "success",
      source: "llm",
      confidence: semanticFrame.confidence,
      llmResponseType: "clarification",
      agentTrace: trace,
      responseKind: rendered.responseKind,
      responseBranch: rendered.responseBranch,
      genericFallbackUsed: rendered.genericFallbackUsed,
    };

    return {
      response: {
        domain: "time_management",
        message,
        toolResults: [],
        metadata,
      },
      metadata,
      intent: {
        intent: "unknown",
        confidence: semanticFrame.confidence,
        args: plan.params,
        rawInput: userInput,
      },
    };
  }

  private async createGuardrailClarificationResponse(
    plan: ExperienceActionPlan,
    args: {
      context: AgentExperienceContext;
      semanticFrame: SemanticFrame;
      userInput: string;
      actionLogId: string;
    }
  ): Promise<TimeManagementHandleResult> {
    const { context, semanticFrame, userInput, actionLogId } = args;
    await this.deps.logService.logSuccess(actionLogId, {
      kind: "guardrail_clarification",
      toolName: plan.toolName,
    });
    const timeLabel = String(
      plan.params.start_label ??
      plan.params.start_time ??
      plan.params.start_iso ??
      "这个时间"
    );
    const clarificationMessage =
      `${timeLabel}已经过去了。你想补记这个时间的记录，` +
      "还是改到今天稍后的时间？";
    const rendered = this.deps.responseBoundary.finalizeRich({
      context,
      frame: semanticFrame,
      plan,
      result: {
        domain: "time_management",
        responseKind: "clarification",
        message: clarificationMessage,
      },
    });
    const finalResponse = rendered.message;
    const trace: AgentTrace = {
      planner: this.getPlannerKind(),
      domain: "time_management",
      mode: "clarification",
      rawInput: userInput,
      contextSnapshot: context,
      semanticFrame,
      actionPlan: plan,
      toolResults: [],
      finalResponse,
      planSummary: plan.summary,
    };
    const metadata: ChatMessageMetadata = {
      intent: semanticFrame.userGoal,
      toolName: plan.toolName,
      actionLogId,
      resultType: "success",
      source: "llm",
      confidence: semanticFrame.confidence,
      llmResponseType: "clarification",
      agentTrace: trace,
      responseKind: rendered.responseKind,
      responseBranch: rendered.responseBranch,
      genericFallbackUsed: rendered.genericFallbackUsed,
      quickActions: [
        "backfill_today",
        "schedule_tomorrow",
        "schedule_other_day",
        "cancel",
      ],
    };

    return {
      response: {
        domain: "time_management",
        message: finalResponse,
        toolResults: [],
        metadata,
      },
      metadata,
      intent: {
        intent: "unknown",
        confidence: semanticFrame.confidence,
        args: plan.params,
        rawInput: userInput,
      },
    };
  }

  private async createPendingConfirmationResponse(
    plan: ExperienceActionPlan,
    args: {
      context: AgentExperienceContext;
      semanticFrame: SemanticFrame;
      userInput: string;
      actionLogId: string;
      source: string;
    }
  ): Promise<TimeManagementHandleResult> {
    if (!plan.toolName) {
      throw new Error("Cannot create confirmation without toolName");
    }
    const {
      context,
      semanticFrame,
      userInput,
      actionLogId,
      source,
    } = args;
    const pending = await this.deps.confirmationService.createConfirmation({
      action_type: semanticFrame.userGoal,
      tool_name: plan.toolName,
      tool_args_json: JSON.stringify(plan.params),
      risk_level: toLegacyRiskLevel(plan.riskLevel),
      description: plan.summary,
      conversation_id: context.conversationId,
      turn_id: context.turnId,
      message_id: context.messageId,
      related_task_id:
        typeof plan.params.taskId === "string"
          ? plan.params.taskId
          : undefined,
    });
    const confirmationId = pending.id;
    await this.deps.logService.logSuccess(actionLogId, {
      kind: "pending_confirmation",
      confirmationId,
      source,
    });

    const renderedResponse = this.deps.responseBoundary.finalizeRich({
      context,
      frame: semanticFrame,
      plan,
      result: {
        domain: "time_management",
        responseKind: "confirmation_required",
      },
    });
    const finalResponse = renderedResponse.message;
    const trace: AgentTrace = {
      planner: this.getPlannerKind(),
      domain: "time_management",
      mode: "clarification",
      rawInput: userInput,
      contextSnapshot: context,
      semanticFrame,
      actionPlan: plan,
      toolResults: [],
      finalResponse,
      planSummary: plan.summary,
      confirmationMetadata: {
        confirmationId,
        riskLevel: plan.riskLevel,
        toolName: plan.toolName,
      },
    };
    const metadata: ChatMessageMetadata = {
      intent: semanticFrame.userGoal,
      toolName: plan.toolName,
      actionLogId,
      confirmationId,
      resultType: "pending_confirmation",
      source: "llm",
      confidence: semanticFrame.confidence,
      llmResponseType: "clarification",
      agentTrace: trace,
      responseKind: renderedResponse.responseKind,
      responseBranch: renderedResponse.responseBranch,
      genericFallbackUsed: renderedResponse.genericFallbackUsed,
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
        args: plan.params,
        rawInput: userInput,
      },
    };
  }

  private async _resolveToolRouterConfirmationFallback(
    result: AgentToolResult,
    plan: ExperienceActionPlan,
    context: AgentExperienceContext,
    execution: {
      semanticFrame: SemanticFrame;
      userInput: string;
      actionLogId: string;
    }
  ): Promise<TimeManagementHandleResult | undefined> {
    if (!result.requiresConfirmation) {
      return undefined;
    }
    return this.createPendingConfirmationResponse(plan, {
      context,
      ...execution,
      source: "tool_router_fallback",
    });
  }

  private async recordGuardrailTrace(
    report: GuardrailRunReport,
    context: AgentExperienceContext
  ): Promise<void> {
    if (
      !this.deps.contextTraceService ||
      !context.conversationId ||
      !context.turnId
    ) {
      return;
    }

    const results = report.results.map((result) => {
      const formatted = formatGuardrailEvidenceForTrace(result.evidence);
      return {
        name: result.name,
        decision: result.decision,
        reason: result.reason ?? null,
        latencyMs: result.latencyMs,
        ...formatted,
      };
    });

    try {
      await this.deps.contextTraceService.recordStep({
        turn_id: context.turnId,
        conversation_id: context.conversationId,
        message_id: context.messageId,
        step_type: "guardrail",
        step_order:
          report.stage === "pre_plan"
            ? 20
            : report.stage === "post_plan"
              ? 30
              : 40,
        output_snapshot: {
          stage: report.stage,
          finalDecision: report.finalDecision,
          firstBlocker: report.firstBlocker ?? null,
          results,
        },
      });
    } catch (error) {
      console.warn("[TimeManagementAgent] guardrail trace failed:", error);
    }
  }

  private composeRecommendationMessage(
    recommendation: { start: string; end: string } | undefined,
    timezone: string,
    meta: {
      shiftedToNextDay?: boolean;
      timeOfDayLabel?: string;
      /** V3.8+ Past Time Disambiguation: 时段已过、非补记，需追问 */
      needsPastTimeClarification?: boolean;
      /** V3.8+ 补记模式：推荐的是今天已过的时段 */
      possibleBackfill?: boolean;
      /** 用户是否明确说了"今天" */
      isExplicitToday?: boolean;
    } = {}
  ): string {
    // ── Case 1: 时段已过且非补记 → 追问意图，不默认顺延明天 ────────────────
    if (meta.needsPastTimeClarification) {
      const todPart = meta.timeOfDayLabel ?? "这个时段";
      if (meta.isExplicitToday) {
        const todayPart = meta.timeOfDayLabel
          ? `今天${meta.timeOfDayLabel}`
          : "今天这个时段";
        const tomorrowPart = meta.timeOfDayLabel
          ? `明天${meta.timeOfDayLabel}`
          : "明天同一时段";
        return `${todayPart}已经过去了。你是想补记${todayPart}的记录，还是想把它安排到${tomorrowPart}？`;
      }
      return `今天${todPart}的时间段已经过去了。你是想补记今天${todPart}的记录，还是安排到之后某一天？`;
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
