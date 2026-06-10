import { z } from "zod";
import {
  RecentActionReader,
  type RecentAction,
} from "@/agent/recent-action/RecentActionReader";
import type { ToolManifest } from "@/agent/schemas";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";

export class GetRecentActionsTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "get_recent_actions",
    skill: "time_management",
    description: "Get recent agent actions for a conversation.",
    inputSchema: z.object({
      conversationId: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
    outputSchema: z.array(z.any()),
    readOnly: true,
    businessSideEffects: [],
    observabilitySideEffects: ["agent_trace_step"],
    riskLevel: "low",
    requiresConfirmation: false,
    reversible: true,
    batchAware: false,
    idempotent: true,
    auditLevel: "trace",
    permissions: ["read:agent_trace"],
  };

  constructor(
    private readonly reader: RecentActionReader = new RecentActionReader(
      null,
      null,
    ),
  ) {
    super();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const conversationId = args.conversationId as string | undefined;
      const limit = typeof args.limit === "number" ? args.limit : 3;
      const actions: RecentAction[] = conversationId
        ? await this.reader.getRecentActions(conversationId, limit)
        : [];

      if (actions.length === 0) {
        return this.success("No recent actions found.", []);
      }

      const summary = actions
        .map((action, index) => `${index + 1}. ${action.summary}`)
        .join("\n");
      return this.success(`Recent actions:\n${summary}`, actions);
    } catch (error) {
      return this.failure(String(error));
    }
  }
}
