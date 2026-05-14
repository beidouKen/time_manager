import type { ToolDefinition, ToolResult } from "@/agent/types";

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

  async execute(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        message: `未找到工具: ${toolName}`,
        error: `Tool "${toolName}" not registered`,
      };
    }
    return tool.execute(args);
  }
}
