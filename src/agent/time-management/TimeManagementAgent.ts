import { ActionPlanner } from "@/agent/experience/ActionPlanner";
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
  actionPlanner: ActionPlanner;
  semanticFrameParser: SemanticFrameParser;
  experienceContextBuilder: ConversationContextBuilder;
  responseBoundary: ResponseBoundary;
  confirmationService: ConfirmationService;
}

export class TimeManagementAgent {
  private recommendationPlanner: RecommendationPlanner;

  constructor(private deps: TimeManagementAgentDeps) {
    this.recommendationPlanner = new RecommendationPlanner(
      new AvailabilityProvider(this.deps.timeBlockService),
      new SchedulingReasoner()
    );
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
    const actionPlan = await this.deps.actionPlanner.plan(semanticFrame, context);
    const toolResults: AgentToolResult[] = [];
    let queryBlocks: TimeBlock[] | undefined;
    let actionLogId: string | undefined;
    let confirmationId: string | undefined;

    const log = await this.deps.logService.logRequest(userInput, semanticFrame.userGoal);
    actionLogId = log.id;

    if (actionPlan.kind === "tool" && actionPlan.toolName) {
      // Confirmation gate: destructive operations require confirmation before execution
      if (actionPlan.requiresConfirmation) {
        const pending = await this.deps.confirmationService.createConfirmation({
          action_type: semanticFrame.userGoal,
          tool_name: actionPlan.toolName,
          tool_args_json: JSON.stringify(actionPlan.params),
          risk_level: toLegacyRiskLevel(actionPlan.riskLevel),
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
      const candidates = await this.recommendationPlanner.plan({
        date: new Date(context.currentDatetime),
        durationMinutes: Number.isFinite(duration) ? duration : 30,
        timezone: context.timezone,
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
    } else {
      await this.deps.logService.logSuccess(log.id, {
        kind: actionPlan.kind,
        userGoal: semanticFrame.userGoal,
      });
    }

    const finalResponse = this.deps.responseBoundary.finalize({
      context,
      frame: semanticFrame,
      plan: actionPlan,
      result: {
        domain: "time_management",
        responseKind:
          actionPlan.kind === "request_recommendation" ? "clarification" : undefined,
        message:
          actionPlan.kind === "request_recommendation"
            ? this.composeRecommendationMessage(
                actionPlan.params.recommendation as
                  | { start: string; end: string }
                  | undefined,
                context.timezone
              )
            : undefined,
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
              : "tool_plan";

    const trace: AgentTrace = {
      planner: "experience",
      domain: "time_management",
      mode: traceMode,
      toolName: actionPlan.toolName,
      rawInput: userInput,
      contextSnapshot: context,
      semanticFrame,
      actionPlan,
      toolResults,
      finalResponse,
    };

    const primaryResult = toolResults[0];
    const mappedIntent: IntentType =
      semanticFrame.userGoal === "create_and_schedule_task"
        ? "schedule_task"
        : "unknown";

    const metadata: ChatMessageMetadata = {
      intent: semanticFrame.userGoal,
      toolName: actionPlan.toolName,
      actionLogId,
      confirmationId,
      relatedTaskId:
        primaryResult?.relatedTaskId ??
        (actionPlan.params.taskId as string | undefined),
      relatedTimeBlockId: primaryResult?.relatedTimeBlockId,
      resultType: primaryResult && !primaryResult.success ? "failure" : "success",
      source: "llm",
      confidence: semanticFrame.confidence,
      llmResponseType: traceMode === "chitchat" ? "chitchat" : "tool_plan",
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
