import { SemanticEventService } from "@/services/SemanticEventService";
import { ActiveContextService } from "@/services/ActiveContextService";
import type { SemanticEventIntent } from "@/types/agent.types";

export interface RecordUiActionInput {
  entity_type: "task" | "time_block";
  entity_id: string;
  event_type: SemanticEventIntent;
  payload?: Record<string, unknown>;
}

export class UiActionEventService {
  private semanticEventService: SemanticEventService;
  private activeContextService: ActiveContextService;

  constructor(
    semanticEventService?: SemanticEventService,
    activeContextService?: ActiveContextService
  ) {
    this.semanticEventService = semanticEventService ?? new SemanticEventService();
    this.activeContextService = activeContextService ?? new ActiveContextService();
  }

  async recordUiAction(
    conversationId: string | null | undefined,
    input: RecordUiActionInput
  ): Promise<void> {
    if (!conversationId) return;

    const taskId = input.entity_type === "task" ? input.entity_id : undefined;
    const timeBlockId = input.entity_type === "time_block" ? input.entity_id : undefined;

    await this.semanticEventService.recordEvent({
      conversation_id: conversationId,
      domain: "time_management",
      intent: input.event_type,
      context_role: "modification",
      confidence: 1,
      related_task_id: taskId,
      related_time_block_id: timeBlockId,
      source: "user_ui",
      entities: {
        actor: "user_ui",
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        ...(input.payload ?? {}),
      },
    });

    await this.activeContextService.touchOnUserAction(conversationId, {
      task_id: taskId,
      time_block_id: timeBlockId,
      intent: input.event_type,
    });
  }
}
