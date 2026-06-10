import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { TaskService } from "@/services/TaskService";

export class DeferTaskTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "defer_task",
    skill: "time_management",
    description: "将一个任务标记为延期（deferred），可选设置延期到某具体时间",
    inputSchema: z.object({ taskId: z.string(), until: z.string().optional() }),
    outputSchema: z.any(),
    readOnly: false,
    businessSideEffects: ["task"],
    observabilitySideEffects: ["agent_trace_step", "semantic_event"],
    riskLevel: "low",
    requiresConfirmation: false,
    reversible: true,
    failureRecovery: "manual",
    batchAware: true,
    idempotent: false,
    auditLevel: "trace",
    permissions: ["write:tasks"],
  };

  private taskService: TaskService;

  constructor(taskService?: TaskService) {
    super();
    this.taskService = taskService ?? new TaskService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const taskId = args.taskId as string;
      if (!taskId) return this.failure("缺少任务 ID");

      const until = typeof args.until === "string" ? args.until : undefined;
      const task = await this.taskService.deferTask(taskId, until);
      const untilLabel = until ? `，延期到 ${until.slice(0, 10)}` : "";
      return this.success(`已将任务「${task.title}」标记为延期${untilLabel}`, task);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
