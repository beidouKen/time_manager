import type {
  LegacyRiskLevel,
  ToolDefinition,
  ToolResult,
} from "@/agent/types";

export abstract class BaseTool implements ToolDefinition {
  abstract name: string;
  abstract description: string;
  abstract requiresConfirmation: boolean;
  abstract riskLevel: LegacyRiskLevel;
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
   *
   * 设计意图：
   * 让 Tool 内部不再写 `if (!x) return this.failure(...)` 模板，
   * 同时把"参数校验失败"统一抽象为异常路径，便于 ToolRouter 集中处理。
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
