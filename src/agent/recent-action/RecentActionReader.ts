/**
 * RecentActionReader — V3.9.0 TEMP BRIDGE
 *
 * Reads recent agent actions for the "你刚刚干了什么" (B2) use case.
 * Uses a 4-tier fallback strategy, prioritising ContextTraceService (trace-first).
 *
 * Tier 1: ContextTraceService.findLatestByConversation — source: "trace"
 * Tier 2: SemanticEventService fallback            — source: "semantic_event"
 * Tier 3: UiActionEventService                     — returns [] + TODO V3.9.8
 * Tier 4: ActionLogService                         — returns [] + TODO V3.9.8
 *
 * Hard constraints (V3.9.0):
 * - Never new service instances; accept injected services only.
 * - Never singleton.
 * - Tier 3/4: no reliable conversation-scoped read API exists; return [] until V3.9.8.
 * - Empty result → caller renders "暂时没有最近动作记录"; NEVER fall back to identity.
 */
import type { ContextTraceService } from "@/services/ContextTraceService";
import type { SemanticEventService } from "@/services/SemanticEventService";

export interface RecentAction {
  timestamp: string;
  intent?: string;
  toolCalls?: string[];
  responseKind?: string;
  affectedEntities?: {
    taskIds?: string[];
    timeBlockIds?: string[];
  };
  /** Which tier provided this action */
  source: "trace" | "semantic_event" | "ui_action_event" | "action_log";
  summary: string;
}

export class RecentActionReader {
  constructor(
    private readonly contextTraceService: ContextTraceService | null | undefined,
    private readonly semanticEventService: SemanticEventService | null | undefined,
  ) {}

  async getRecentActions(conversationId: string, n = 3): Promise<RecentAction[]> {
    // Tier 1: ContextTraceService (trace-first)
    if (this.contextTraceService) {
      try {
        const steps = await this.contextTraceService.findLatestByConversation(
          conversationId,
          n * 5
        );
        const actionSteps = steps.filter(
          (s) => s.step_type === "execute" || s.step_type === "response"
        );
        if (actionSteps.length > 0) {
          return actionSteps.slice(0, n).map((step): RecentAction => {
            let output: Record<string, unknown> = {};
            try {
              if (step.output_snapshot_json) {
                output = JSON.parse(step.output_snapshot_json) as Record<string, unknown>;
              }
            } catch { /* ignore parse errors */ }

            const toolName = output.toolName as string | undefined;
            const summaryFromOutput = output.summary as string | undefined;
            const summary = summaryFromOutput
              ?? (toolName ? `执行了 ${toolName}` : `完成了一个操作 (${step.step_type})`);

            return {
              timestamp: step.created_at,
              toolCalls: toolName ? [toolName] : undefined,
              source: "trace",
              summary,
            };
          });
        }
      } catch { /* fall through to Tier 2 */ }
    }

    // Tier 2: SemanticEventService fallback
    if (this.semanticEventService) {
      try {
        const events = await this.semanticEventService.findByConversation(conversationId, { limit: n * 3 });
        const actionEvents = events.filter(
          (e) => e.domain === "time_management" && !e.invalidated_at
        );
        if (actionEvents.length > 0) {
          return actionEvents.slice(0, n).map((e): RecentAction => {
            let entities: Record<string, unknown> = {};
            try {
              if (e.entities_json) {
                entities = JSON.parse(e.entities_json) as Record<string, unknown>;
              }
            } catch { /* ignore */ }
            return {
              timestamp: e.created_at,
              intent: e.intent,
              source: "semantic_event",
              summary: (entities.summary as string) ?? `执行了 ${e.intent} 操作`,
            };
          });
        }
      } catch { /* fall through */ }
    }

    // Tier 3/4: TODO V3.9.8 — UiActionEventService / ActionLogService lack reliable
    // conversation-scoped read APIs. Return empty until V3.9.8 adds them.
    return [];
  }
}
