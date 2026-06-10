// ============================================================
// BaseTool.ts — V3.9.2 Tool Governance
//
// Every tool MUST declare a ToolManifest (abstract field).
// The four ToolDefinition interface properties (name / description /
// requiresConfirmation / riskLevel) are derived from the manifest
// via getters, so subclasses only need to implement manifest + execute.
//
// ROUTER_INTERNAL_KEYS contract (see ToolRouter.ts):
//   ToolRouter strips __confirmationId (and future internal keys) from
//   args before calling tool.execute(). Tools never receive these keys.
// ============================================================

import type {
  LegacyRiskLevel,
  ToolDefinition,
  ToolResult,
} from "@/agent/types";
import type { ToolManifest } from "@/agent/schemas";

export abstract class BaseTool implements ToolDefinition {
  /** V3.9.2: every registered tool must provide a ToolManifest. */
  abstract readonly manifest: ToolManifest;

  // ToolDefinition properties derived from manifest — no subclass override needed.
  get name(): string { return this.manifest.name; }
  get description(): string { return this.manifest.description; }
  get requiresConfirmation(): boolean { return this.manifest.requiresConfirmation; }
  get riskLevel(): LegacyRiskLevel { return this.manifest.riskLevel; }

  abstract execute(args: Record<string, unknown>): Promise<ToolResult>;

  protected success(message: string, data?: unknown): ToolResult {
    return { success: true, message, data };
  }

  protected failure(error: string): ToolResult {
    return { success: false, message: error, error };
  }

  /**
   * V2.5 参数校验辅助方法。
   * - 参数存在且非空 → 返回原值（类型断言为 T）
   * - 参数缺失 → throw Error，由 ToolRouter.execute 的 try/catch 统一转换为
   *   AgentToolResult { success: false }
   */
  protected requireParam<T>(
    args: Record<string, unknown>,
    key: string,
    label?: string
  ): T {
    const value = args[key];
    if (value === undefined || value === null || value === "") {
      throw new Error(`缺少必需参数: ${label ?? key}`);
    }
    return value as T;
  }
}
