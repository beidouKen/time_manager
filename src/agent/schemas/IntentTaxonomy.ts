// ============================================================
// IntentTaxonomy.ts — V3.9.1a User-Intent Layer Contract
//
// Vocabulary: user-intent layer (what the user wants to achieve).
// This is DISTINCT from the legacy execution/tool-intent layer:
//
//   Intent (this file) = V3.9 user intent
//     → e.g. "action_delete_task", "query_unscheduled_tasks"
//     → produced by SemanticFrameParser / LLM router
//     → consumed by ActionPlanner to determine PlanKind
//
//   IntentType (src/agent/types.ts) = legacy execution/tool intent
//     → e.g. "delete_task", "list_tasks"
//     → one-to-one with ToolRouter registered names
//     → consumed by CONFIRMATION_POLICY, AgentCommand, AgentActionPlan
//
// The two namespaces coexist in V3.9.1a.
// Convergence (dropping IntentType) is deferred to V3.9.1b / V3.9.3 / V3.9.7.
// Bridge: src/agent/types.ts → legacyIntentBridge
// ============================================================

export const Intents = {
  // ── Query intents (read-only, no side effects) ────────────────
  QUERY_UNSCHEDULED_TASKS: "query_unscheduled_tasks",
  QUERY_SCHEDULED_TASKS: "query_scheduled_tasks",
  QUERY_COMPLETED_TASKS: "query_completed_tasks",
  QUERY_TODAY_SCHEDULE: "query_today_schedule",
  QUERY_CURRENT_FOCUS: "query_current_focus",
  QUERY_RECENT_ACTION: "query_recent_action",
  // V3.9.5 append-only (D6)
  QUERY_TOMORROW_SCHEDULE: "query_tomorrow_schedule",
  QUERY_TASK_SCHEDULE_STATUS: "query_task_schedule_status",

  // ── Action intents (write side effects) ───────────────────────
  ACTION_CREATE_TASK: "action_create_task",
  ACTION_SCHEDULE_TASK: "action_schedule_task",
  ACTION_CREATE_AND_SCHEDULE: "action_create_and_schedule",
  ACTION_RESCHEDULE: "action_reschedule",
  ACTION_MARK_COMPLETED: "action_mark_completed",
  ACTION_REOPEN: "action_reopen",
  ACTION_CANCEL_SCHEDULE: "action_cancel_schedule",
  ACTION_DELETE_TASK: "action_delete_task",
  ACTION_ARCHIVE_TASK: "action_archive_task",
  ACTION_DEFER_TASK: "action_defer_task",

  // ── Proposal intents (pending-proposal lifecycle) ─────────────
  PROPOSAL_PROPOSE: "proposal_propose",
  PROPOSAL_REFINE: "proposal_refine",
  PROPOSAL_CONFIRM: "proposal_confirm",
  PROPOSAL_REJECT: "proposal_reject",

  // ── Meta intents ──────────────────────────────────────────────
  CLARIFICATION_REQUEST: "clarification_request",
  LOW_SIGNAL: "low_signal",
} as const;

export type Intent = (typeof Intents)[keyof typeof Intents];
