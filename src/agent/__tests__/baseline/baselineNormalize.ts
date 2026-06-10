// ============================================================
// baselineNormalize.ts — V3.9-pre baseline snapshot helpers
//
// TEST-ONLY. No production imports allowed. This file may only
// be imported from src/agent/__tests__/baseline/*.test.ts.
//
// Purpose:
//   Extract a stable, normalized snapshot of one agent turn for
//   use as an inline snapshot in v3_9_failure_baseline.test.ts.
//   All volatile fields (ids, timestamps, latency, floats) are
//   stripped or replaced with stable proxies so that snapshots
//   do not drift between runs.
//
// Stability contract:
//   - Never import from src/services/, src/repositories/, or
//     any component path.
//   - Never call production code directly; only read from the
//     harness objects already returned by createMockAgentHarness.
//   - If this file needs to change to stay in sync with harness
//     API changes, update carefully — do NOT change snapshot
//     content in the baseline test file itself.
// ============================================================

import type { MockAgentHarness } from "@/agent/testing/createMockAgentHarness";

// ─── Public interfaces ─────────────────────────────────────────────────────────

export interface BaselineTraceStep {
  step_type: string;
  step_order: number;
  /** Sorted list of keys present in output_snapshot_json (no values). */
  outputKeys: string[];
  hasError: boolean;
}

export interface BaselineTurnSnapshot {
  input: string;
  domain: string | null;
  /**
   * Semantic-layer intent from SemanticEventService.
   * NOTE: legacy response.intent.intent is often "unknown" and is recorded
   * separately in violationNotes when it differs.
   */
  intent: string | null;
  planKind: string | null;
  toolCalls: string[];
  /**
   * responseKind is NOT persisted in the current architecture (V3.9-pre).
   * It is consumed inside ResponseComposer and discarded.
   * Value is always "not_observable" until V3.9.0 introduces the contract.
   */
  responseKind: "not_observable" | string;
  responseText: string;
  traceSummary: BaselineTraceStep[];
  businessWriteObserved: {
    tasks: Array<{
      title: string;
      status: string;
      hasCompletedAt: boolean;
      /** true when any block in the harness has this task's id linked */
      hasBlockLink: boolean;
    }>;
    blocks: Array<{
      title: string;
      type: string;
      status: string;
      /** Minutes relative to the fake-clock "now" at extract time. Negative = past. */
      startOffsetMin: number;
      endOffsetMin: number;
      hasTaskLink: boolean;
    }>;
  };
  /**
   * Known gaps or violation notes recorded at extraction time.
   * These are static annotations, not dynamic assertions.
   */
  violationNotes: string[];
}

// ─── Normalization helpers ─────────────────────────────────────────────────────

const UUID_IN_TEXT = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi;

function normalizeResponseText(text: string): string {
  return text.replace(UUID_IN_TEXT, "<id>");
}

function safeParseJson(s: string | undefined | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toOutputKeys(json: string | undefined | null): string[] {
  const obj = safeParseJson(json);
  if (!obj) return [];
  return Object.keys(obj).sort();
}

function minutesFromNow(isoString: string | undefined | null): number {
  if (!isoString) return 0;
  const nowMs = Date.now();
  const targetMs = new Date(isoString).getTime();
  return Math.round((targetMs - nowMs) / 60_000);
}

// ─── Main extraction function ──────────────────────────────────────────────────

/**
 * Extract a fully normalized baseline snapshot from one agent turn.
 *
 * Call AFTER processInput has returned. The function reads from harness
 * repos (traceStepRepo, eventRepo, tasks, blocks) — all in-memory.
 *
 * @param harness  The MockAgentHarness returned by createMockAgentHarness()
 * @param response The AgentResponse returned by agent.processInput()
 * @param input    The original user input string (for labelling)
 */
export async function extractTurnBaseline(
  harness: MockAgentHarness,
  response: Awaited<ReturnType<MockAgentHarness["agent"]["processInput"]>>,
  input: string,
): Promise<BaselineTurnSnapshot> {
  const turnId = response.metadata?.turnId ?? null;
  const agentTrace = response.metadata?.agentTrace ?? null;

  // ── domain ──────────────────────────────────────────────────────────────────
  const domain: string | null = agentTrace?.domain ?? null;

  // ── semantic intent (C2 layer) ───────────────────────────────────────────────
  let intent: string | null = null;
  if (turnId) {
    const event = harness.eventRepo.events.find((e) => e.turn_id === turnId);
    intent = event?.intent ?? null;
  }

  // ── planKind ─────────────────────────────────────────────────────────────────
  const planKind: string | null = agentTrace?.actionPlan?.kind ?? null;

  // ── toolCalls (derived — no single "toolCalls" field exists) ─────────────────
  const rawTools: Array<string | undefined> = [
    agentTrace?.actionPlan?.toolName,
    ...(agentTrace?.actionPlan?.actions?.map((a) => a.toolName) ?? []),
    response.metadata?.toolName,
  ];
  const toolCalls = [...new Set(rawTools.filter((t): t is string => !!t))];

  // ── responseKind (NOT observable in current architecture) ────────────────────
  const responseKind = "not_observable" as const;

  // ── responseText ──────────────────────────────────────────────────────────────
  const responseText = normalizeResponseText(response.message ?? "");

  // ── trace summary (first 10 steps) ───────────────────────────────────────────
  let traceSummary: BaselineTraceStep[] = [];
  if (turnId) {
    const steps = await harness.traceStepRepo.findByTurn(turnId);
    traceSummary = steps.slice(0, 10).map((s) => ({
      step_type: s.step_type,
      step_order: s.step_order,
      outputKeys: toOutputKeys(s.output_snapshot_json),
      hasError: !!s.error,
    }));
  }

  // ── businessWriteObserved ────────────────────────────────────────────────────
  const allTasks = harness.tasks.tasks.filter((t) => !t.deleted_at);
  const allBlocks = harness.blocks.blocks.filter((b) => !b.deleted_at);

  const blockTaskIds = new Set(allBlocks.map((b) => b.task_id).filter(Boolean));

  const taskSnap = allTasks.map((t) => ({
    title: t.title,
    status: t.status,
    hasCompletedAt: !!t.completed_at,
    hasBlockLink: blockTaskIds.has(t.id),
  }));

  const blockSnap = allBlocks.map((b) => ({
    title: b.title,
    type: b.type,
    status: b.status,
    startOffsetMin: minutesFromNow(b.start_time),
    endOffsetMin: minutesFromNow(b.end_time),
    hasTaskLink: !!b.task_id,
  }));

  // ── violationNotes ────────────────────────────────────────────────────────────
  const violationNotes: string[] = [
    "responseKind is not_observable: ResponseComposer discards ResponseKind; V3.9.0 should expose it on AgentTrace.",
    "semanticType field absent in current SemanticFrame; V3.9 to introduce as part of activity/task distinction.",
  ];

  // Record legacy intent mismatch
  const legacyIntent = (response.intent as { intent?: string } | undefined)?.intent;
  if (legacyIntent && legacyIntent !== "unknown" && legacyIntent !== intent) {
    violationNotes.push(
      `legacy response.intent.intent="${legacyIntent}" differs from semantic intent="${intent}".`,
    );
  }

  return {
    input,
    domain,
    intent,
    planKind,
    toolCalls,
    responseKind,
    responseText,
    traceSummary,
    businessWriteObserved: { tasks: taskSnap, blocks: blockSnap },
    violationNotes,
  };
}

/**
 * Deep-clone a snapshot and strip any remaining volatile fields that may
 * have slipped through extractTurnBaseline (defensive pass).
 *
 * Use this immediately before toMatchInlineSnapshot().
 */
export function normalizeBaselineSnapshot(snapshot: BaselineTurnSnapshot): BaselineTurnSnapshot {
  const json = JSON.stringify(snapshot, (_key, value) => {
    // Belt-and-suspenders: remove any stray id/timestamp fields
    if (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
    ) {
      return "<timestamp>";
    }
    return value;
  });
  return JSON.parse(json) as BaselineTurnSnapshot;
}
