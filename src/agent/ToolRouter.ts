// ============================================================
// ToolRouter.ts — V3.9.2 Tool Governance
//
// Minimal governance layer added in V3.9.2:
//   1. getManifest(name) — expose manifest for callers that need policy info.
//   2. ROUTER_INTERNAL_KEYS — stripped from args before tool.execute() so that
//      tools remain pure business logic with no awareness of governance keys.
//   3. Destructive tool guard — if a tool declares requiresConfirmation=true
//      and args does NOT contain __confirmationId, router returns a structured
//      "requiresConfirmation" response instead of executing.
//      Confirmed path: AgentService.confirmAction injects __confirmationId;
//      the router detects it, strips it, and allows execution.
// ============================================================

import type { AgentToolResult, ToolDefinition, ToolResult } from "@/agent/types";
import type { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";

/**
 * Internal governance keys that ToolRouter injects / consumes and MUST be
 * stripped from args before any tool.execute() call.
 */
const ROUTER_INTERNAL_KEYS = new Set(["__confirmationId"]);

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
   * V3.9.2: expose the manifest for a registered tool (if available).
   * Callers can use this for policy decisions without executing the tool.
   */
  getManifest(name: string): ToolManifest | undefined {
    const tool = this.tools.get(name);
    if (!tool) return undefined;
    return (tool as BaseTool).manifest;
  }

  /**
   * Execute a tool with governance enforcement:
   *
   * - If the tool requires confirmation AND `args.__confirmationId` is absent
   *   → return a structured "blocked" response (not an error) so callers can
   *   surface a confirmation prompt to the user.
   * - If `args.__confirmationId` is present → strip it before calling execute.
   * - All ROUTER_INTERNAL_KEYS are always stripped before execute.
   * - Unknown tool → success: false
   * - execute throw → success: false
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

    // V3.9.2: manifest-based governance check
    const manifest = (tool as BaseTool).manifest;
    if (manifest?.requiresConfirmation) {
      const hasConfirmation = typeof args.__confirmationId === "string" &&
        args.__confirmationId.length > 0;
      if (!hasConfirmation) {
        return {
          success: false,
          requiresConfirmation: true,
          message: `工具 "${toolName}" 需要用户确认后才能执行`,
          error: `Tool "${toolName}" requires confirmation`,
          toolName,
        };
      }
    }

    // Strip all router-internal keys before delegating to tool business logic
    const cleanArgs = stripInternalKeys(args);

    let raw: ToolResult;
    try {
      raw = await tool.execute(cleanArgs);
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function stripInternalKeys(
  args: Record<string, unknown>
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!ROUTER_INTERNAL_KEYS.has(key)) {
      clean[key] = value;
    }
  }
  return clean;
}
