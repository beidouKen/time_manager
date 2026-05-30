import { IntentParser } from "@/agent/IntentParser";
import { ToolRouter } from "@/agent/ToolRouter";
import type { ParsedIntent, ToolResult } from "@/agent/types";
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

export interface AgentResponse {
  message: string;
  intent: ParsedIntent;
  toolResult?: ToolResult;
  confirmationId?: string;
}

const INTENT_TO_TOOL: Record<string, string> = {
  create_task: "create_task",
  list_tasks: "list_tasks",
  update_task: "update_task",
  delete_task: "delete_task",
  mark_task_completed: "mark_task_completed",
  create_time_block: "create_time_block",
  move_time_block: "update_time_block",
  delete_time_block: "delete_time_block",
  schedule_task: "schedule_task",
  reschedule_day: "reschedule_day",
  get_today_plan: "get_today_plan",
  explain_schedule: "explain_schedule",
};

export class AgentService {
  private parser: IntentParser;
  private router: ToolRouter;
  private logService: ActionLogService;
  private confirmService: ConfirmationService;
  private taskService: TaskService;

  private lastOperatedTaskId: string | null = null;

  constructor() {
    this.parser = new IntentParser();
    this.router = new ToolRouter();
    this.logService = new ActionLogService();
    this.confirmService = new ConfirmationService();
    this.taskService = new TaskService();
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

  async processInput(userInput: string): Promise<AgentResponse> {
    const intent = this.parser.parse(userInput);

    const log = await this.logService.logRequest(
      userInput,
      intent.intent
    );

    if (intent.intent === "unknown") {
      await this.logService.logFailure(log.id, "无法识别意图");
      return {
        message: "抱歉，我没有理解你的意思。你可以试试：\n- 创建任务\n- 查看今天安排\n- 安排任务到时间轴\n- 标记任务为完成\n- 删除任务",
        intent,
      };
    }

    const toolName = INTENT_TO_TOOL[intent.intent];
    if (!toolName) {
      await this.logService.logFailure(log.id, `未映射的意图: ${intent.intent}`);
      return {
        message: "该功能暂未实现",
        intent,
      };
    }

    // Resolve task reference ("这个任务" etc.) to actual taskId
    const resolvedArgs = await this.resolveArgs(intent);

    // Check if confirmation is needed
    if (this.router.hasToolRequiringConfirmation(toolName)) {
      const confirmation = await this.confirmService.createConfirmation({
        action_type: intent.intent,
        tool_name: toolName,
        tool_args_json: JSON.stringify(resolvedArgs),
        description: this.buildConfirmDescription(intent),
        risk_level: this.router.getTool(toolName)!.riskLevel,
      });

      await this.logService.logToolExecution(log.id, toolName, resolvedArgs);

      return {
        message: `⚠️ 该操作需要确认：${confirmation.description ?? intent.intent}\n请确认或取消。`,
        intent,
        confirmationId: confirmation.id,
      };
    }

    // Execute directly
    await this.logService.logToolExecution(log.id, toolName, resolvedArgs);
    const result = await this.router.execute(toolName, resolvedArgs);

    if (result.success) {
      await this.logService.logSuccess(log.id, result.data);
      this.trackLastTask(toolName, result);
    } else {
      await this.logService.logFailure(log.id, result.error ?? result.message);
    }

    return {
      message: result.message,
      intent,
      toolResult: result,
    };
  }

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
    const result = await this.router.execute(confirmation.tool_name, args);

    const log = await this.logService.logRequest(
      `[确认执行] ${confirmation.action_type}`,
      confirmation.action_type
    );

    if (result.success) {
      await this.logService.logSuccess(log.id, result.data);
      this.trackLastTask(confirmation.tool_name, result);
    } else {
      await this.logService.logFailure(log.id, result.error ?? result.message);
    }

    return {
      message: result.message,
      intent: {
        intent: confirmation.action_type as ParsedIntent["intent"],
        confidence: 1,
        args,
        rawInput: "",
      },
      toolResult: result,
    };
  }

  async rejectAction(confirmationId: string): Promise<AgentResponse> {
    await this.confirmService.reject(confirmationId);

    return {
      message: "已取消操作",
      intent: { intent: "unknown", confidence: 0, args: {}, rawInput: "" },
    };
  }

  private async resolveArgs(
    intent: ParsedIntent
  ): Promise<Record<string, unknown>> {
    const args = { ...intent.args };

    // Resolve "这个任务" / "那个任务" to the last operated task
    if (
      args.titleKeyword &&
      typeof args.titleKeyword === "string" &&
      (args.titleKeyword.includes("这个") || args.titleKeyword.includes("那个") || args.titleKeyword === "")
    ) {
      if (this.lastOperatedTaskId) {
        args.taskId = this.lastOperatedTaskId;
        delete args.titleKeyword;
        return args;
      }
    }

    // Try to resolve titleKeyword to taskId via search
    if (args.titleKeyword && typeof args.titleKeyword === "string" && !args.taskId) {
      const tasks = await this.taskService.getTasks({ excludeDeleted: true });
      const keyword = args.titleKeyword as string;
      const matched = tasks.find((t) =>
        t.title.includes(keyword) || keyword.includes(t.title)
      );
      if (matched) {
        args.taskId = matched.id;
      }
    }

    // For schedule_task, resolve time expressions to actual ISO strings
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

  private trackLastTask(_toolName: string, result: ToolResult): void {
    if (!result.data) return;

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
