import type { AgentToolResult, ToolDefinition, ToolResult } from "@/agent/types";

export class ToolRouter {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  hasToolRequiringConfirmation(name: string): boolean {
    const tool = this.tools.get(name);
    return tool?.requiresConfirmation ?? false;
  }

  /**
   * V2.5：执行指定工具并返回 AgentToolResult。
   *
   * 统一容错处理：
   * 1. tool not found → success: false
   * 2. tool.execute 内部 throw（含 BaseTool.requireParam）→ success: false
   * 3. Service 层异常 → success: false
   * 4. 正常返回 → normalizeResult 提取关联实体 ID
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<AgentToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        message: `未找到工具: ${toolName}`,
        error: `Tool "${toolName}" not registered`,
      };
    }

    let raw: ToolResult;
    try {
      raw = await tool.execute(args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        message: msg,
        error: msg,
      };
    }

    return this.normalizeResult(toolName, raw);
  }

  /**
   * 将 Tool 返回的 ToolResult 规范化为 AgentToolResult。
   * 尝试从 data 中提取关联的 Task / TimeBlock ID，供上层（AgentService、Chat metadata）使用。
   */
  private normalizeResult(
    _toolName: string,
    raw: ToolResult
  ): AgentToolResult {
    const result: AgentToolResult = {
      success: raw.success,
      message: raw.message,
      data: raw.data,
      error: raw.error,
    };

    if (raw.data && typeof raw.data === "object") {
      const data = raw.data as Record<string, unknown>;

      // 直接是 Task 实体（含 id 字段且为任务相关 tool 的典型返回）
      if (typeof data.id === "string" && typeof data.status === "string" && typeof data.title === "string") {
        // 若含 start_time 则是 TimeBlock，否则是 Task
        if (typeof data.start_time === "string") {
          result.relatedTimeBlockId = data.id;
          if (typeof data.task_id === "string") {
            result.relatedTaskId = data.task_id;
          }
        } else {
          result.relatedTaskId = data.id;
        }
      }

      // schedule_task 返回 { task, timeBlock }
      if (data.task && typeof data.task === "object") {
        const task = data.task as Record<string, unknown>;
        if (typeof task.id === "string") result.relatedTaskId = task.id;
      }
      if (data.timeBlock && typeof data.timeBlock === "object") {
        const tb = data.timeBlock as Record<string, unknown>;
        if (typeof tb.id === "string") result.relatedTimeBlockId = tb.id;
      }

      // explainTask / explainSchedule 返回 { task, timeBlocks }
      if (!result.relatedTaskId && data.task && typeof (data.task as Record<string, unknown>).id === "string") {
        result.relatedTaskId = (data.task as Record<string, unknown>).id as string;
      }
    }

    return result;
  }
}
