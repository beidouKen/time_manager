// ============================================================
// PlanKind.ts — V3.9.1a Execution-Plan Kind Contract
//
// PlanKind ≠ Intent.
//   Intent    = what the user wants (user-intent layer)
//   PlanKind  = which runtime execution branch to take
//   Tool name = the specific tool invoked (only for QUERY / TOOL / PROPOSAL)
//   ResponseKind = the product-level response contract
//
// Relationship:
//   Intent → PlanKind → (Tool? + ResponseKind)
//
// Examples:
//   QUERY_UNSCHEDULED_TASKS → QUERY            → list_tasks    → QUERY_RESULT
//   ACTION_DELETE_TASK      → TOOL             → delete_task   → CONFIRMATION → ACTION_SUCCESS
//   ACTION_SCHEDULE_TASK    → PROPOSAL         → propose_sched → CONFIRMATION
//   QUERY_RECENT_ACTION     → DIRECT_RESPONSE  → (no tool)     → RECENT_ACTION
//   CLARIFICATION_REQUEST   → CLARIFICATION    → (no tool)     → CLARIFICATION
//   (guardrail blocked)     → BLOCKED          → (no tool)     → BLOCKED
//
// V3.9.1a scope:
//   Only introduces this enum at the schema / contract layer.
//   ExperienceActionPlan.kind (8 values, runtime) is NOT replaced yet.
//   First real consumers of PlanKind:
//     - V3.9.3 Guardrails (must branch by PlanKind)
//     - V3.9.7 Response (selects ResponseKind candidates by PlanKind)
// ============================================================

export const PlanKinds = {
  QUERY: "query",
  TOOL: "tool",
  PROPOSAL: "proposal",
  CLARIFICATION: "clarification",
  DIRECT_RESPONSE: "direct_response",
  BLOCKED: "blocked",
} as const;

export type PlanKind = (typeof PlanKinds)[keyof typeof PlanKinds];
