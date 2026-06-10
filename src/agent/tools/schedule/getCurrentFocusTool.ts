import { z } from "zod";
import { TaskReadModelService } from "@/agent/read-model/TaskReadModelService";
import type { ToolManifest } from "@/agent/schemas";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";
import { formatTime } from "@/lib/dateUtils";
import { TaskService } from "@/services/TaskService";
import { TimeBlockService } from "@/services/TimeBlockService";

export class GetCurrentFocusTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name: "get_current_focus",
    skill: "time_management",
    description: "Get the current focus time block.",
    inputSchema: z.object({ now: z.string().optional() }).passthrough(),
    outputSchema: z.any(),
    readOnly: true,
    businessSideEffects: [],
    observabilitySideEffects: ["agent_trace_step"],
    riskLevel: "low",
    requiresConfirmation: false,
    reversible: true,
    batchAware: false,
    idempotent: true,
    auditLevel: "trace",
    permissions: ["read:timeblocks"],
  };

  private readonly readModel: TaskReadModelService;

  constructor(readModel?: TaskReadModelService);
  constructor(taskService?: TaskService, timeBlockService?: TimeBlockService);
  constructor(
    first?: TaskReadModelService | TaskService,
    timeBlockService?: TimeBlockService,
  ) {
    super();
    this.readModel =
      first instanceof TaskReadModelService
        ? first
        : new TaskReadModelService(
            first ?? new TaskService(),
            timeBlockService ?? new TimeBlockService(),
          );
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const now = typeof args.now === "string" ? new Date(args.now) : new Date();
      const block = await this.readModel.getCurrentFocus(now);
      if (!block) {
        return this.success("No current focus block.", null);
      }
      return this.success(
        `Current focus: ${formatTime(block.start_time)}-${formatTime(block.end_time)} ${block.title}`,
        block,
      );
    } catch (error) {
      return this.failure(String(error));
    }
  }
}
