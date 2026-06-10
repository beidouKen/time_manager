// ============================================================
// ToolManifest.ts — V3.9.1a Tool Self-Description Contract
//
// Defines the ToolManifest interface that each tool will implement
// in V3.9.2 Tool Governance. Only the interface is defined here;
// no tool files are modified in V3.9.1a.
//
// Key distinction:
//   businessSideEffects    = mutations visible to the user / domain
//   observabilitySideEffects = writes to audit / trace / event tables
//   (a readOnly tool can still emit observability side effects)
//
// riskLevel uses the same vocabulary as LegacyRiskLevel in types.ts
// ("low" | "medium" | "high") to match the 19 existing tool instances.
// It is NOT the agent-layer RiskLevel ("safe" | "confirm" | "destructive").
// ============================================================

import type { ZodTypeAny } from "zod";

/** Domain skill the tool belongs to. */
export type SkillName = "time_management" | "knowledge" | "writing" | "meta";

/** Domain-visible side effects — mutations users care about. */
export type BusinessSideEffectScope =
  | "task"
  | "timeblock"
  | "confirmation"
  | "active_context";

/** Audit / observability side effects — writes to internal tables only. */
export type ObservabilitySideEffectScope =
  | "agent_trace_step"
  | "semantic_event"
  | "turn"
  | "ui_action_event"
  | "action_log";

/**
 * Self-description contract for every registered tool.
 * Instantiated in V3.9.2 Tool Governance; only the interface is defined here.
 */
export interface ToolManifest {
  /** ToolRouter registration name (matches toolName on ExperienceActionPlan). */
  name: string;
  /** Domain skill this tool belongs to. */
  skill: SkillName;
  /** Human-readable description used in LLM prompts and audit logs. */
  description: string;
  /** Zod schema for tool input validation. */
  inputSchema: ZodTypeAny;
  /** Zod schema for tool output validation. */
  outputSchema: ZodTypeAny;
  /** True when the tool performs no domain-visible writes. */
  readOnly: boolean;
  /** Domain-visible side effects this tool may produce. */
  businessSideEffects: ReadonlyArray<BusinessSideEffectScope>;
  /** Observability side effects this tool may produce. */
  observabilitySideEffects: ReadonlyArray<ObservabilitySideEffectScope>;
  /** Risk level matching legacy tool vocabulary (low / medium / high). */
  riskLevel: "low" | "medium" | "high";
  /** Whether this tool requires user confirmation before execution. */
  requiresConfirmation: boolean;
  /** Whether the effect can be undone or compensated. */
  reversible: boolean;
  /** Recovery strategy if the tool fails (undefined = no automatic recovery). */
  failureRecovery?: "undo" | "compensate" | "manual";
  /** True when the tool can process multiple items in a single call. */
  batchAware: boolean;
  /** True when repeated identical calls produce the same result. */
  idempotent: boolean;
  /** Audit verbosity level for this tool's executions. */
  auditLevel: "none" | "trace" | "trace+semantic_event";
  /** Permission scopes required to call this tool. */
  permissions: ReadonlyArray<string>;
}
