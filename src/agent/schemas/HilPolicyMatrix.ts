// ============================================================
// HilPolicyMatrix.ts — V3.9.2 HIL Policy Matrix
//
// Multi-dimensional policy table mapping Intent → HIL decision.
// Replaces the flat CONFIRMATION_POLICY (legacy IntentType → RiskLevel)
// with a richer per-intent governance record.
//
// Dimensions per entry:
//   requiresConfirmation  — must pause and prompt user before execution
//   riskLevel             — "low" | "medium" | "high"
//   reversible            — can the action be undone
//   batchAware            — affects multiple records in one call
//   preview               — should the agent show a dry-run preview first
//   reason                — human-readable rationale (for audit / UI tooltip)
//
// Compatibility layer:
//   legacyHilDecision(intentType) — adapts old IntentType strings to this table
//   (used by AgentService during transition; to be removed post-V3.9.3)
// ============================================================

import type { Intent } from "@/agent/schemas/IntentTaxonomy";
import type { IntentType } from "@/agent/types";

export type HilRiskLevel = "low" | "medium" | "high";

export interface HilPolicyEntry {
  intent: Intent;
  requiresConfirmation: boolean;
  riskLevel: HilRiskLevel;
  reversible: boolean;
  batchAware: boolean;
  /** Show a dry-run preview before asking for confirmation */
  preview: boolean;
  reason: string;
}

// ─── Full 22-intent matrix ────────────────────────────────────────────────────

export const HIL_POLICY_MATRIX: Record<Intent, HilPolicyEntry> = {
  // ── Query intents — never require confirmation ────────────────────────────
  query_unscheduled_tasks: {
    intent: "query_unscheduled_tasks",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Read-only query; no state mutation.",
  },
  query_scheduled_tasks: {
    intent: "query_scheduled_tasks",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Read-only query; no state mutation.",
  },
  query_completed_tasks: {
    intent: "query_completed_tasks",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Read-only query; no state mutation.",
  },
  query_today_schedule: {
    intent: "query_today_schedule",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Read-only query; no state mutation.",
  },
  query_current_focus: {
    intent: "query_current_focus",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Read-only context check; no state mutation.",
  },
  query_recent_action: {
    intent: "query_recent_action",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Read-only audit query; no state mutation.",
  },
  // V3.9.5 append-only (D6)
  query_tomorrow_schedule: {
    intent: "query_tomorrow_schedule",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Read-only query for tomorrow's schedule; no state mutation.",
  },
  query_task_schedule_status: {
    intent: "query_task_schedule_status",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Read-only query for a task's scheduling status; no state mutation.",
  },

  // ── Action intents — write side effects ───────────────────────────────────
  action_create_task: {
    intent: "action_create_task",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Creating a task is low-risk and easily undone by deletion.",
  },
  action_schedule_task: {
    intent: "action_schedule_task",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Scheduling a single task to a time block; can be moved or deleted.",
  },
  action_create_and_schedule: {
    intent: "action_create_and_schedule",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Compound creation+schedule; both parts are reversible individually.",
  },
  action_reschedule: {
    intent: "action_reschedule",
    requiresConfirmation: true,
    riskLevel: "high",
    reversible: true,
    batchAware: true,
    preview: true,
    reason: "Bulk rearrangement of time blocks; high cognitive cost if wrong.",
  },
  action_mark_completed: {
    intent: "action_mark_completed",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Marking complete is low-friction; status can be reverted.",
  },
  action_reopen: {
    intent: "action_reopen",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Reopening a completed task is low-risk.",
  },
  action_cancel_schedule: {
    intent: "action_cancel_schedule",
    requiresConfirmation: true,
    riskLevel: "medium",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Removing a scheduled time block disrupts the plan; confirm intent.",
  },
  action_delete_task: {
    intent: "action_delete_task",
    requiresConfirmation: true,
    riskLevel: "high",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Soft-deletion cascades to time blocks; high-risk without confirmation.",
  },
  action_archive_task: {
    intent: "action_archive_task",
    requiresConfirmation: true,
    riskLevel: "medium",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Archiving hides the task from active views; confirm to avoid accidental loss.",
  },
  action_defer_task: {
    intent: "action_defer_task",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: true,
    preview: false,
    reason: "Deferring is low-friction and easily reversed.",
  },

  // ── Proposal intents — lifecycle management ───────────────────────────────
  proposal_propose: {
    intent: "proposal_propose",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: true,
    reason: "Proposal creation only; execution is deferred until confirmed.",
  },
  proposal_refine: {
    intent: "proposal_refine",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Refining a proposal before confirmation; no execution yet.",
  },
  proposal_confirm: {
    intent: "proposal_confirm",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: false,
    batchAware: false,
    preview: false,
    reason: "User explicitly confirmed — the prior HIL gate has already fired.",
  },
  proposal_reject: {
    intent: "proposal_reject",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Rejecting a proposal is safe (no execution).",
  },

  // ── Meta intents ──────────────────────────────────────────────────────────
  clarification_request: {
    intent: "clarification_request",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "No execution; agent asks user for more information.",
  },
  low_signal: {
    intent: "low_signal",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: "Low-confidence signal; agent will ask for clarification.",
  },
};

// ─── Public accessor ──────────────────────────────────────────────────────────

/** Look up the HIL policy for a given user intent. */
export function getHilPolicy(intent: Intent): HilPolicyEntry {
  return HIL_POLICY_MATRIX[intent];
}

// ─── Legacy compatibility layer ───────────────────────────────────────────────
//
// Adapts the old IntentType strings (tool-name layer) to the HIL matrix.
// Used by AgentService during the V3.9.x transition period.
// TODO(V3.9.3): remove once AgentService routes through Intent directly.

const LEGACY_TO_INTENT: Partial<Record<IntentType, Intent>> = {
  // query tools → query intents
  list_tasks: "query_unscheduled_tasks",
  list_time_blocks: "query_today_schedule",
  get_today_plan: "query_today_schedule",
  get_free_slots: "query_today_schedule",
  detect_conflicts: "query_today_schedule",
  explain_task: "query_current_focus",
  explain_schedule: "query_today_schedule",
  // action tools → action intents
  create_task: "action_create_task",
  schedule_task: "action_create_and_schedule",
  bind_task_to_time_block: "action_schedule_task",
  update_task: "action_create_task",       // low-risk update
  move_time_block: "action_schedule_task",
  mark_task_completed: "action_mark_completed",
  delete_task: "action_delete_task",
  delete_time_block: "action_cancel_schedule",
  reschedule_day: "action_reschedule",
};

/**
 * Legacy compatibility shim: map an old IntentType to a HIL policy.
 * Falls back to a safe default for unknown/unmapped types.
 */
export function legacyHilDecision(intentType: IntentType): HilPolicyEntry {
  const intent = LEGACY_TO_INTENT[intentType];
  if (intent) return HIL_POLICY_MATRIX[intent];

  // Unknown or unmapped → treat as safe/low-risk with no confirmation
  return {
    intent: "low_signal",
    requiresConfirmation: false,
    riskLevel: "low",
    reversible: true,
    batchAware: false,
    preview: false,
    reason: `No HIL mapping for legacy IntentType "${intentType}"; defaulting to safe.`,
  };
}
