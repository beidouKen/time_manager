import type {
  AgentExperienceContext,
  AgentToolResult,
  ExperienceActionPlan,
  SemanticFrame,
} from "@/agent/types";
import type { ResponseKind } from "@/agent/schemas";
import type { TimeBlock } from "@/types/timeblock.types";

export interface RendererInput {
  context: AgentExperienceContext;
  frame: SemanticFrame;
  plan: ExperienceActionPlan;
  toolResults: AgentToolResult[];
  queryBlocks?: TimeBlock[];
  queryTasks?: Array<{ title: string; status: string }>;
  recentActions?: Array<{ summary: string; source: string }>;
  blocked?: { guardrailName: string; reason?: string; nextStep?: string };
  /** Existing handler copy may pass through the selected renderer unchanged. */
  explicitMessage?: string;
  /** Local 24-value branch label retained for trace.responseBranch. */
  branchLabel?: string;
}

export interface RendererOutput {
  message: string;
  responseKind: ResponseKind;
  responseBranch: string;
  genericFallbackUsed: boolean;
}

export interface ResponseRenderer {
  readonly kind: ResponseKind;
  render(input: RendererInput): RendererOutput;
}
