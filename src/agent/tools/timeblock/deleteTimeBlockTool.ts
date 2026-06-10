import { z } from "zod";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolManifest } from "@/agent/schemas";
import type { ToolResult } from "@/agent/types";
import { TimeBlockService } from "@/services/TimeBlockService";

export class DeleteTimeBlockTool extends BaseTool {
  // V3.9.2: requiresConfirmation=true per HIL matrix (action_cancel_schedule → always)
  readonly manifest: ToolManifest = {
    name: "delete_time_block",
    skill: "time_management",
    description: "Delete a time block",
    inputSchema: z.object({ timeBlockId: z.string() }).passthrough(),
    outputSchema: z.any(),
    readOnly: false,
    businessSideEffects: ["timeblock"],
    observabilitySideEffects: ["agent_trace_step", "semantic_event"],
    riskLevel: "medium",
    requiresConfirmation: true,
    reversible: true,
    failureRecovery: "manual",
    batchAware: false,
    idempotent: false,
    auditLevel: "trace+semantic_event",
    permissions: ["write:timeblocks"],
  };

  private timeBlockService: TimeBlockService;

  constructor(timeBlockService?: TimeBlockService) {
    super();
    this.timeBlockService = timeBlockService ?? new TimeBlockService();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const timeBlockId = (args.timeBlockId ?? args.blockId) as string | undefined;
      if (!timeBlockId) return this.failure("Missing time block ID");

      const block = await this.timeBlockService.getBlockById(timeBlockId);
      if (!block) return this.failure("Time block not found");

      await this.timeBlockService.deleteTimeBlock(timeBlockId);
      return this.success(`Deleted time block "${block.title}"`);
    } catch (e) {
      return this.failure(String(e));
    }
  }
}
