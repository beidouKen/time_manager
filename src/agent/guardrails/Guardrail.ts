import type { WorkingMemoryPacket } from "@/agent/context/WorkingMemoryPacket";
import type {
  AgentExperienceContext,
  AgentToolResult,
  ChatMessageMetadata,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";
import type { SkillName, ToolManifest } from "@/agent/schemas";

export type GuardrailStage =
  | "pre_route"
  | "pre_plan"
  | "post_plan"
  | "pre_tool"
  | "post_response";

export type GuardrailDecision =
  | "allow"
  | "block"
  | "ask_confirmation"
  | "ask_clarification";

export interface GuardrailResult {
  pass: boolean;
  decision: GuardrailDecision;
  reason?: string;
  evidence?: unknown;
}

export interface GuardrailContext {
  stage: GuardrailStage;
  now: Date;
  conversationId?: string;
  turnId?: string;
  messageId?: string;
  userInput: string;
  workingMemoryPacket?: WorkingMemoryPacket;
  pendingConfirmationId?: string;
  semanticFrame?: SemanticFrame;
  experienceContext?: AgentExperienceContext;
  routeDomain?: string;
  rawPlan?: ExperienceActionPlan;
  safetyResult?: unknown;
  plan?: ExperienceActionPlan;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolManifest?: ToolManifest;
  currentSkill?: SkillName;
  responseMessage?: string;
  responseKind?: string;
  metadata?: ChatMessageMetadata;
  toolResults?: AgentToolResult[];
  __confirmationId?: string;
  priorGuardrailResults?: GuardrailRunResult[];
}

export interface Guardrail {
  readonly name: string;
  readonly stage: GuardrailStage;
  check(
    ctx: GuardrailContext
  ): GuardrailResult | Promise<GuardrailResult>;
}

export interface GuardrailRunResult {
  name: string;
  decision: GuardrailDecision;
  reason?: string;
  evidence?: unknown;
  latencyMs: number;
}

export interface GuardrailRunReport {
  stage: GuardrailStage;
  results: GuardrailRunResult[];
  finalDecision: GuardrailDecision;
  firstBlocker?: string;
}

export function formatGuardrailEvidenceForTrace(
  evidence: unknown,
  maxBytes = 512
): { evidence: unknown; evidenceTruncated: boolean } {
  const json = JSON.stringify(evidence ?? null);
  const encoder = new TextEncoder();
  if (encoder.encode(json).byteLength <= maxBytes) {
    return {
      evidence,
      evidenceTruncated: false,
    };
  }

  let truncated = "";
  for (const character of json) {
    const candidate = truncated + character;
    if (encoder.encode(candidate).byteLength > maxBytes) break;
    truncated = candidate;
  }
  return {
    evidence: truncated,
    evidenceTruncated: true,
  };
}
