// ============================================================
// src/agent/schemas/index.ts — V3.9.1a Schema Contracts Barrel
//
// Central export point for V3.9 agent schema contracts.
// Three vocabulary layers (all separate):
//
//   src/types/             — DB-layer schemas (Zod, persistence)
//   src/agent/types.ts     — Runtime agent types (IntentType, legacy)
//   src/agent/schemas/     — V3.9 product-level contracts (this dir)
//
// Consumers of this barrel:
//   V3.9.0  — may reference Intent / ResponseKinds for new paths
//   V3.9.2  — instantiates ToolManifest on each tool
//   V3.9.3  — branches Guardrails on PlanKind
//   V3.9.7  — wires ResponseKind into ResponseComposer
// ============================================================

export { Intents } from "./IntentTaxonomy";
export type { Intent } from "./IntentTaxonomy";

export { PlanKinds } from "./PlanKind";
export type { PlanKind } from "./PlanKind";

export { ResponseKinds } from "./ResponseContract";
export type { ResponseKind } from "./ResponseContract";

export type {
  ToolManifest,
  SkillName,
  BusinessSideEffectScope,
  ObservabilitySideEffectScope,
} from "./ToolManifest";

export { HIL_POLICY_MATRIX, getHilPolicy, legacyHilDecision } from "./HilPolicyMatrix";
export type { HilPolicyEntry, HilRiskLevel } from "./HilPolicyMatrix";
