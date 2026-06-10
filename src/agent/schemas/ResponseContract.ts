// ============================================================
// ResponseContract.ts — V3.9.1a Product-Level Response Contract
//
// ResponseKind (this file) = abstract product-level response contract
//   8 values representing the semantic category of the agent's reply.
//   Produced by: ResponseComposer (V3.9.7, after migration)
//   Consumed by: ResponseRenderer / frontend ChatMessage bubble
//
// This is DISTINCT from the legacy renderer-branch enum in
// src/agent/experience/ResponseComposer.ts (21 values, renderer keys).
// The two coexist in V3.9.1a; migration to this contract is deferred
// to V3.9.7 Response.
// ============================================================

export const ResponseKinds = {
  QUERY_RESULT: "query_result",
  ACTION_SUCCESS: "action_success",
  CLARIFICATION: "clarification",
  CONFIRMATION: "confirmation",
  RECENT_ACTION: "recent_action",
  BLOCKED: "blocked",
  ERROR: "error",
  SUGGESTION: "suggestion",
} as const;

export type ResponseKind = (typeof ResponseKinds)[keyof typeof ResponseKinds];
