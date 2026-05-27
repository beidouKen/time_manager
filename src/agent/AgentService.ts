import { IntentParser } from "@/agent/IntentParser";
import { ToolRouter } from "@/agent/ToolRouter";
import { DeepSeekClient } from "@/agent/llm/DeepSeekClient";
import { ContextBuilder } from "@/agent/llm/contextBuilder";
import type { RecentMessage } from "@/agent/llm/contextBuilder";
import { LLMPlanner } from "@/agent/LLMPlanner";
import type {
  AgentActionPlan,
  AgentCommand,
  AgentToolResult,
  ChatMessageMetadata,
  IntentType,
  ParsedIntent,
  RiskLevel,
} from "@/agent/types";
import { CONFIRMATION_POLICY, toLegacyRiskLevel } from "@/agent/types";
import { ActionLogService } from "@/services/ActionLogService";
import { ConfirmationService } from "@/services/ConfirmationService";
import { TaskService } from "@/services/TaskService";

import { CreateTaskTool } from "@/agent/tools/task/createTaskTool";
import { UpdateTaskTool } from "@/agent/tools/task/updateTaskTool";
import { DeleteTaskTool } from "@/agent/tools/task/deleteTaskTool";
import { ListTasksTool } from "@/agent/tools/task/listTasksTool";
import { MarkTaskCompletedTool } from "@/agent/tools/task/markTaskCompletedTool";
import { CreateTimeBlockTool } from "@/agent/tools/timeblock/createTimeBlockTool";
import { UpdateTimeBlockTool } from "@/agent/tools/timeblock/updateTimeBlockTool";
import { DeleteTimeBlockTool } from "@/agent/tools/timeblock/deleteTimeBlockTool";
import { ListTimeBlocksTool } from "@/agent/tools/timeblock/listTimeBlocksTool";
import { BindTaskToTimeBlockTool } from "@/agent/tools/timeblock/bindTaskToTimeBlockTool";
import { ScheduleTaskTool } from "@/agent/tools/schedule/scheduleTaskTool";
import { RescheduleDayTool } from "@/agent/tools/schedule/rescheduleDayTool";
import { DetectConflictsTool } from "@/agent/tools/schedule/detectConflictsTool";
import { GetFreeSlotsTool } from "@/agent/tools/schedule/getFreeSlotsTool";
import { GetTodayPlanTool } from "@/agent/tools/schedule/getTodayPlanTool";
import { ExplainTaskTool } from "@/agent/tools/explain/explainTaskTool";
import { ExplainScheduleTool } from "@/agent/tools/explain/explainScheduleTool";

// ─── AgentResponse ─────────────────────────────────────────────────────────

export interface AgentResponse {
  message: string;
  intent: ParsedIntent;
  toolResult?: AgentToolResult;
  confirmationId?: string;
  /** V2.5：action_log 记录 ID，供 chatStore 写入 metadata */
  actionLogId?: string;
  /** V2.5：完整 metadata，供 chatStore 写入 conversation_messages.metadata_json */
  metadata?: ChatMessageMetadata;
}

// ─── Intent → Tool 映射表（snake_case，与 IntentType 和 Tool.name 三处一致） ──

const INTENT_TO_TOOL: Record<string, string> = {
  create_task: "create_task",
  list_tasks: "list_tasks",
  update_task: "update_task",
  delete_task: "delete_task",
  mark_task_completed: "mark_task_completed",
  create_time_block: "create_time_block",
  move_time_block: "update_time_block",
  delete_time_block: "delete_time_block",
  list_time_blocks: "list_time_blocks",
  bind_task_to_time_block: "bind_task_to_time_block",
  schedule_task: "schedule_task",
  reschedule_day: "reschedule_day",
  detect_conflicts: "detect_conflicts",
  get_free_slots: "get_free_slots",
  get_today_plan: "get_today_plan",
  explain_task: "explain_task",
  explain_schedule: "explain_schedule",
};

// ─── ProcessInput 调用上下文（V3 新增） ─────────────────────────────────────

export interface ProcessInputContext {
  /** chatStore 传入的最近消息，用于 LLM 指代消解 */
  recentMessages?: RecentMessage[];
}

// ─── AgentService ───────────────────────────────────────────────────────────

export class AgentService {
  private parser: IntentParser;
  private router: ToolRouter;
  private logService: ActionLogService;
  private confirmService: ConfirmationService;
  private taskService: TaskService;

  // V3：LLM 相关组件
  private llmPlanner: LLMPlanner;
  private contextBuilder: ContextBuilder;

  private lastOperatedTaskId: string | null = null;
  private lastOperatedTimeBlockId: string | null = null;

  constructor() {
    this.parser = new IntentParser();
    this.router = new ToolRouter();
    this.logService = new ActionLogService();
    this.confirmService = new ConfirmationService();
    this.taskService = new TaskService();

    // V3：初始化 LLM 组件（通过 LLMClient 接口隔离，不直接依赖 fetch）
    const llmClient = new DeepSeekClient();
    this.llmPlanner = new LLMPlanner(llmClient, this.router);
    this.contextBuilder = new ContextBuilder();

    this.registerTools();
  }

  private registerTools(): void {
    this.router.register(new CreateTaskTool());
    this.router.register(new UpdateTaskTool());
    this.router.register(new DeleteTaskTool());
    this.router.register(new ListTasksTool());
    this.router.register(new MarkTaskCompletedTool());
    this.router.register(new CreateTimeBlockTool());
    this.router.register(new UpdateTimeBlockTool());
    this.router.register(new DeleteTimeBlockTool());
    this.router.register(new ListTimeBlocksTool());
    this.router.register(new BindTaskToTimeBlockTool());
    this.router.register(new ScheduleTaskTool());
    this.router.register(new RescheduleDayTool());
    this.router.register(new DetectConflictsTool());
    this.router.register(new GetFreeSlotsTool());
    this.router.register(new GetTodayPlanTool());
    this.router.register(new ExplainTaskTool());
    this.router.register(new ExplainScheduleTool());
  }

  // ─── 主入口：处理用户输入（V3 扩展版） ─────────────────────────────────────

  async processInput(
    userInput: string,
    context?: ProcessInputContext
  ): Promise<AgentResponse> {
    // Step 1：检查 LLM Agent 是否可用
    const llmEnabled =
      (import.meta.env.VITE_LLM_AGENT_ENABLED as string | undefined) === "true";
    const apiKey = (import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined) ?? "";

    if (llmEnabled) {
      // Step 2：API key 缺失时提示用户，但仍可 fallback
      if (!apiKey) {
        // 记录日志
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, "API key 未配置");

        // 提示用户，同时 fallback 到规则解析继续处理
        const ruleResponse = await this.processWithRules(userInput);
        if (ruleResponse.metadata) {
          ruleResponse.metadata.llmResponseType = undefined;
        }
        // 在消息前加入 API key 缺失提示
        ruleResponse.message =
          "⚠️ 尚未配置 DeepSeek API Key（请在 .env 文件中设置 VITE_DEEPSEEK_API_KEY），已使用规则解析。\n\n" +
          ruleResponse.message;
        return ruleResponse;
      }

      // Step 3：尝试 LLM 路径
      try {
        const llmResult = await this.processWithLLM(userInput, context);
        if (llmResult !== null) {
          return llmResult;
        }
        // llmResult=null 表示需要 fallback
      } catch (e) {
        console.warn("[AgentService] LLM 路径异常，fallback 到规则解析：", e);
      }
    }

    // Step 4：规则 IntentParser（fallback 或 LLM 未启用）
    return this.processWithRules(userInput);
  }

  // ─── LLM 路径 ────────────────────────────────────────────────────────────

  private async processWithLLM(
    userInput: string,
    context?: ProcessInputContext
  ): Promise<AgentResponse | null> {
    // 构造上下文
    const llmContext = await this.contextBuilder.build(
      context?.recentMessages ?? [],
      this.lastOperatedTaskId,
      this.lastOperatedTimeBlockId
    );

    // 调用 LLMPlanner
    const planResult = await this.llmPlanner.plan(userInput, llmContext);
    const modelName = planResult.modelName;

    switch (planResult.type) {
      case "api_key_missing": {
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, planResult.errorMessage ?? "API key 缺失");
        return {
          message:
            "⚠️ 尚未配置 DeepSeek API Key，请在 .env 文件中设置 VITE_DEEPSEEK_API_KEY。",
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: {
            intent: "unknown",
            actionLogId: log.id,
            resultType: "failure",
            source: "llm",
            llmModel: modelName,
          },
        };
      }

      case "network_error": {
        // 网络错误：提示用户，fallback 到规则解析
        console.warn("[AgentService] LLM 网络错误，fallback：", planResult.errorMessage);
        const ruleResponse = await this.processWithRules(userInput);
        if (ruleResponse.metadata) {
          ruleResponse.metadata.llmModel = modelName;
        }
        ruleResponse.message =
          "⚠️ 网络请求失败，已切换为规则解析。\n\n" + ruleResponse.message;
        return ruleResponse;
      }

      case "parse_error":
      case "fallback": {
        // 解析失败或其他可 fallback 的错误：返回 null 触发规则解析
        console.warn(
          `[AgentService] LLM ${planResult.type}，fallback：`,
          planResult.errorMessage
        );
        return null;
      }

      case "clarification": {
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, "LLM 追问：信息不足");
        const question =
          planResult.clarifyingQuestion ?? "请提供更多信息以便我理解你的需求。";
        return {
          message: question,
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: {
            intent: "unknown",
            actionLogId: log.id,
            resultType: "failure",
            source: "llm",
            llmModel: modelName,
            confidence: planResult.confidence,
            llmResponseType: "clarification",
          },
        };
      }

      case "chitchat": {
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, "LLM 闲聊响应");
        return {
          message: planResult.replyMessage ?? "好的。",
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: {
            intent: "unknown",
            actionLogId: log.id,
            resultType: "failure",
            source: "llm",
            llmModel: modelName,
            confidence: planResult.confidence,
            llmResponseType: "chitchat",
          },
        };
      }

      case "unsupported": {
        const log = await this.logService.logRequest(userInput, "unknown");
        await this.logService.logFailure(log.id, "LLM 判断：超出能力范围");
        return {
          message:
            planResult.replyMessage ??
            "抱歉，该功能超出了 Time Manager 当前的能力范围，无法执行。",
          intent: { intent: "unknown", confidence: 0, args: {}, rawInput: userInput },
          actionLogId: log.id,
          metadata: {
            intent: "unknown",
            actionLogId: log.id,
            resultType: "failure",
            source: "llm",
            llmModel: modelName,
            confidence: planResult.confidence,
            llmResponseType: "unsupported",
          },
        };
      }

      case "tool_plan": {
        // LLM 生成了工具计划，交给通用执行流程
        return this.executeToolPlan(
          userInput,
          planResult.intent!,
          planResult.toolName!,
          planResult.params ?? {},
          planResult.requiresConfirmation ?? false,
          planResult.riskLevel ?? "safe",
          planResult.summary ?? planResult.toolName!,
          {
            source: "llm",
            llmModel: modelName,
            confidence: planResult.confidence,
            llmResponseType: "tool_plan",
          }
        );
      }

      default:
        return null;
    }
  }

  // ─── 规则路径（原有逻辑保持不变） ──────────────────────────────────────────

  private async processWithRules(userInput: string): Promise<AgentResponse> {
    // Step 1：解析意图
    const parsed = this.parser.parse(userInput);

    // Step 2：构造 AgentCommand
    const command: AgentCommand = {
      id: crypto.randomUUID(),
      rawText: userInput,
      intent: parsed.intent,
      params: parsed.args,
      createdAt: new Date().toISOString(),
    };

    // Step 3：记录 pending action_log
    const log = await this.logService.logRequest(userInput, parsed.intent);

    // Step 4：意图未知
    if (parsed.intent === "unknown") {
      await this.logService.logFailure(log.id, "无法识别意图");
      return {
        message:
          "抱歉，我没有理解你的意思。你可以试试：\n- 创建任务\n- 查看今天安排\n- 安排任务到时间轴\n- 标记任务为完成\n- 删除任务",
        intent: parsed,
        actionLogId: log.id,
        metadata: {
          intent: "unknown",
          actionLogId: log.id,
          resultType: "failure",
          source: "chat",
        },
      };
    }

    // Step 5：查找对应 Tool
    const toolName = INTENT_TO_TOOL[parsed.intent];
    if (!toolName) {
      await this.logService.logFailure(log.id, `未映射的意图: ${parsed.intent}`);
      return {
        message: "该功能暂未实现",
        intent: parsed,
        actionLogId: log.id,
        metadata: {
          intent: parsed.intent,
          actionLogId: log.id,
          resultType: "failure",
          source: "chat",
        },
      };
    }

    // Step 6：解析参数引用（"这个任务" 等）
    const resolvedArgs = await this.resolveArgs(parsed);

    // Step 7：构造 AgentActionPlan
    const riskLevel: RiskLevel = CONFIRMATION_POLICY[parsed.intent] ?? "safe";
    const needsConfirmation =
      riskLevel === "destructive" ||
      this.router.hasToolRequiringConfirmation(toolName);

    const plan: AgentActionPlan = {
      id: crypto.randomUUID(),
      commandId: command.id,
      intent: parsed.intent,
      toolName,
      params: resolvedArgs,
      requiresConfirmation: needsConfirmation,
      riskLevel,
      summary: this.buildConfirmDescription(parsed),
      createdAt: new Date().toISOString(),
    };

    // Step 8：需要确认 → 创建 confirmation 记录，挂起执行
    if (plan.requiresConfirmation) {
      const confirmation = await this.confirmService.createConfirmation({
        action_type: parsed.intent,
        tool_name: toolName,
        tool_args_json: JSON.stringify(resolvedArgs),
        description: plan.summary,
        risk_level: toLegacyRiskLevel(riskLevel),
      });

      await this.logService.logToolExecution(log.id, toolName, resolvedArgs);

      const metadata: ChatMessageMetadata = {
        intent: parsed.intent,
        toolName,
        actionLogId: log.id,
        confirmationId: confirmation.id,
        resultType: "pending_confirmation",
        source: "chat",
      };

      return {
        message: `⚠️ 该操作需要确认：${plan.summary}\n请确认或取消。`,
        intent: parsed,
        confirmationId: confirmation.id,
        actionLogId: log.id,
        metadata,
      };
    }

    // Step 9：直接执行
    await this.logService.logToolExecution(log.id, toolName, resolvedArgs);
    const result = await this.router.execute(toolName, resolvedArgs);

    if (result.success) {
      await this.logService.logSuccess(log.id, result.data);
      this.trackLastEntities(toolName, result);
    } else {
      await this.logService.logFailure(log.id, result.error ?? result.message);
    }

    const metadata: ChatMessageMetadata = {
      intent: parsed.intent,
      toolName,
      actionLogId: log.id,
      relatedTaskId: result.relatedTaskId,
      relatedTimeBlockId: result.relatedTimeBlockId,
      resultType: result.success ? "success" : "failure",
      source: "chat",
    };

    return {
      message: result.message,
      intent: parsed,
      toolResult: result,
      actionLogId: log.id,
      metadata,
    };
  }

  // ─── 通用工具执行（LLM 路径和规则路径共用） ─────────────────────────────────

  private async executeToolPlan(
    userInput: string,
    intent: IntentType,
    toolName: string,
    params: Record<string, unknown>,
    requiresConfirmation: boolean,
    riskLevel: RiskLevel,
    summary: string,
    extraMetadata: Partial<ChatMessageMetadata>
  ): Promise<AgentResponse> {
    const fakeParsedIntent: ParsedIntent = {
      intent,
      confidence: 1,
      args: params,
      rawInput: userInput,
    };

    const log = await this.logService.logRequest(userInput, intent);

    if (requiresConfirmation) {
      const confirmation = await this.confirmService.createConfirmation({
        action_type: intent,
        tool_name: toolName,
        tool_args_json: JSON.stringify(params),
        description: summary,
        risk_level: toLegacyRiskLevel(riskLevel),
      });

      await this.logService.logToolExecution(log.id, toolName, params);

      const metadata: ChatMessageMetadata = {
        intent,
        toolName,
        actionLogId: log.id,
        confirmationId: confirmation.id,
        resultType: "pending_confirmation",
        ...extraMetadata,
      };

      return {
        message: `⚠️ 该操作需要确认：${summary}\n请确认或取消。`,
        intent: fakeParsedIntent,
        confirmationId: confirmation.id,
        actionLogId: log.id,
        metadata,
      };
    }

    // 直接执行
    await this.logService.logToolExecution(log.id, toolName, params);
    const result = await this.router.execute(toolName, params);

    if (result.success) {
      await this.logService.logSuccess(log.id, result.data);
      this.trackLastEntities(toolName, result);
    } else {
      await this.logService.logFailure(log.id, result.error ?? result.message);
    }

    const metadata: ChatMessageMetadata = {
      intent,
      toolName,
      actionLogId: log.id,
      relatedTaskId: result.relatedTaskId,
      relatedTimeBlockId: result.relatedTimeBlockId,
      resultType: result.success ? "success" : "failure",
      ...extraMetadata,
    };

    return {
      message: result.message,
      intent: fakeParsedIntent,
      toolResult: result,
      actionLogId: log.id,
      metadata,
    };
  }

  // ─── 确认执行 ────────────────────────────────────────────────────────────

  async confirmAction(confirmationId: string): Promise<AgentResponse> {
    const confirmation = await this.confirmService.getById(confirmationId);
    if (!confirmation) {
      return {
        message: "确认记录不存在或已过期",
        intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
      };
    }

    if (confirmation.status !== "pending") {
      return {
        message: `该操作已${confirmation.status === "confirmed" ? "确认" : "取消"}`,
        intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
      };
    }

    await this.confirmService.confirm(confirmationId);

    const args = JSON.parse(confirmation.tool_args_json) as Record<string, unknown>;

    // 记录确认执行日志
    const log = await this.logService.logRequest(
      `[确认执行] ${confirmation.action_type}`,
      confirmation.action_type
    );
    await this.logService.logToolExecution(log.id, confirmation.tool_name, args);

    const result = await this.router.execute(confirmation.tool_name, args);

    if (result.success) {
      await this.logService.logSuccess(log.id, result.data);
      this.trackLastEntities(confirmation.tool_name, result);
    } else {
      await this.logService.logFailure(log.id, result.error ?? result.message);
    }

    const metadata: ChatMessageMetadata = {
      intent: confirmation.action_type,
      toolName: confirmation.tool_name,
      actionLogId: log.id,
      confirmationId,
      relatedTaskId: result.relatedTaskId,
      relatedTimeBlockId: result.relatedTimeBlockId,
      resultType: result.success ? "success" : "failure",
      source: "chat",
    };

    return {
      message: result.message,
      intent: {
        intent: confirmation.action_type as IntentType,
        confidence: 1,
        args,
        rawInput: "",
      },
      toolResult: result,
      actionLogId: log.id,
      metadata,
    };
  }

  // ─── 拒绝执行（Phase 4：新建 cancelled action_log） ──────────────────────

  async rejectAction(confirmationId: string): Promise<AgentResponse> {
    // 先获取 confirmation 以取得 tool_name / tool_args 用于日志记录
    const confirmation = await this.confirmService.getById(confirmationId);

    // 无论 confirmation 是否存在，尝试更新状态
    try {
      await this.confirmService.reject(confirmationId);
    } catch {
      // confirmation 不存在或已非 pending，忽略
    }

    // 新建一条 cancelled action_log（不反查旧 log）
    const toolName = confirmation?.tool_name ?? "unknown";
    const toolArgs = confirmation?.tool_args_json
      ? (JSON.parse(confirmation.tool_args_json) as Record<string, unknown>)
      : {};

    const log = await this.logService.logRequest(
      `[拒绝确认] ${confirmation?.action_type ?? confirmationId}`,
      confirmation?.action_type
    );
    await this.logService.logToolExecution(log.id, toolName, {
      ...toolArgs,
      _confirmationId: confirmationId,
    });
    await this.logService.logCancelled(log.id);

    const metadata: ChatMessageMetadata = {
      intent: confirmation?.action_type,
      toolName,
      actionLogId: log.id,
      confirmationId,
      resultType: "rejected",
      source: "chat",
    };

    return {
      message: "已取消操作",
      intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
      actionLogId: log.id,
      metadata,
    };
  }

  // ─── 私有辅助方法 ────────────────────────────────────────────────────────

  private async resolveArgs(
    intent: ParsedIntent
  ): Promise<Record<string, unknown>> {
    const args = { ...intent.args };

    // 解析"这个任务" / "那个任务" → lastOperatedTaskId
    if (
      args.titleKeyword &&
      typeof args.titleKeyword === "string" &&
      (args.titleKeyword.includes("这个") ||
        args.titleKeyword.includes("那个") ||
        args.titleKeyword === "")
    ) {
      if (this.lastOperatedTaskId) {
        args.taskId = this.lastOperatedTaskId;
        delete args.titleKeyword;
        return args;
      }
    }

    // 通过 titleKeyword 搜索匹配任务
    if (
      args.titleKeyword &&
      typeof args.titleKeyword === "string" &&
      !args.taskId
    ) {
      const tasks = await this.taskService.getTasks({ excludeDeleted: true });
      const keyword = args.titleKeyword as string;
      const matched = tasks.find(
        (t) => t.title.includes(keyword) || keyword.includes(t.title)
      );
      if (matched) {
        args.taskId = matched.id;
      }
    }

    // schedule_task：将时间表达式解析为 ISO 时间字符串
    if (intent.intent === "schedule_task" && !args.start_time) {
      const { start_time, end_time } = this.resolveScheduleTime(args);
      args.start_time = start_time;
      args.end_time = end_time;
    }

    return args;
  }

  private resolveScheduleTime(args: Record<string, unknown>): {
    start_time: string;
    end_time: string;
  } {
    const dateStr = args.date as string | undefined;
    const timeOfDay = args.timeOfDay as string | undefined;
    const duration = (args.duration as number) ?? 60;

    const baseDate = dateStr ? new Date(dateStr) : new Date();

    let startHour = 9;
    let startMinute = 0;

    if (timeOfDay) {
      const [h, m] = timeOfDay.split(":").map(Number);
      startHour = h;
      startMinute = m;
    }

    const start = new Date(baseDate);
    start.setHours(startHour, startMinute, 0, 0);
    const end = new Date(start.getTime() + duration * 60 * 1000);

    return {
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    };
  }

  private trackLastEntities(_toolName: string, result: AgentToolResult): void {
    if (result.relatedTaskId) {
      this.lastOperatedTaskId = result.relatedTaskId;
    }
    if (result.relatedTimeBlockId) {
      this.lastOperatedTimeBlockId = result.relatedTimeBlockId;
    }

    // 兼容旧路径：从 data 对象中提取
    if (!result.relatedTaskId && result.data) {
      const data = result.data as Record<string, unknown>;
      if (data.id && typeof data.id === "string") {
        this.lastOperatedTaskId = data.id;
      } else if (data.task && typeof data.task === "object") {
        const task = data.task as Record<string, unknown>;
        if (task.id && typeof task.id === "string") {
          this.lastOperatedTaskId = task.id;
        }
      }
    }
  }

  private buildConfirmDescription(intent: ParsedIntent): string {
    switch (intent.intent) {
      case "delete_task":
        return `删除任务${intent.args.titleKeyword ? `「${intent.args.titleKeyword}」` : ""}（将同时删除关联时间块）`;
      case "delete_time_block":
        return "删除时间块";
      case "reschedule_day":
        return "重新排列今天的计划（未完成的时间块将被重新安排）";
      default:
        return intent.intent;
    }
  }
}
