// ============================================================
// businessTableSnapshot.ts — V3.9.2 Tool Governance
//
// Test helper for asserting that readOnly tools do NOT mutate
// any business tables (tasks / time_blocks / confirmations /
// active_context) after invocation.
//
// Design rationale:
//   Agent turns always write to observability tables
//   (agent_trace_steps / semantic_events / turns / ui_action_events).
//   Therefore the "readOnly" assertion must be scoped to BUSINESS
//   tables only — not total row counts across the whole DB.
//   See V3.9 long-term project file §11.2 for details.
//
// Usage:
//   const port = memorySnapshotPort({ taskService, timeBlockService,
//                                     confirmationRepo, activeContextRepo });
//   const before = await takeBusinessSnapshot(port);
//   await tool.execute(args);
//   const after  = await takeBusinessSnapshot(port);
//   assertNoBusinessChange(before, after);
//
// Production use: NONE — this file is imported only by test files.
// ============================================================

import { expect } from "vitest";
import type {
  MemoryTaskService,
  MemoryTimeBlockService,
  MemoryConfirmationRepository,
  MemoryActiveContextRepository,
} from "@/agent/testing/memoryServices";

// ─── Snapshot shape ───────────────────────────────────────────────────────────

/**
 * Row counts for the four business tables.
 * Observability tables (agent_trace_steps / semantic_events / turns /
 * ui_action_events / action_logs) are intentionally excluded.
 */
export interface BusinessTableSnapshot {
  /** tasks table row count */
  tasks: number;
  /** time_blocks table row count */
  time_blocks: number;
  /** pending_confirmations table row count */
  confirmations: number;
  /** active_contexts table row count */
  active_context: number;
}

// ─── Port interface ───────────────────────────────────────────────────────────

/**
 * Minimal interface for reading business-table row counts.
 * Decouples the snapshot helper from concrete repository implementations,
 * making it easy to adapt to in-memory or real-DB backends.
 */
export interface BusinessSnapshotPort {
  countTasks(): Promise<number>;
  countTimeBlocks(): Promise<number>;
  countConfirmations(): Promise<number>;
  countActiveContexts(): Promise<number>;
}

// ─── Snapshot functions ───────────────────────────────────────────────────────

export async function takeBusinessSnapshot(
  port: BusinessSnapshotPort,
): Promise<BusinessTableSnapshot> {
  const [tasks, time_blocks, confirmations, active_context] = await Promise.all([
    port.countTasks(),
    port.countTimeBlocks(),
    port.countConfirmations(),
    port.countActiveContexts(),
  ]);
  return { tasks, time_blocks, confirmations, active_context };
}

/**
 * Assert that no business tables changed between two snapshots.
 * Throws a descriptive vitest expect failure if any count differs.
 */
export function assertNoBusinessChange(
  before: BusinessTableSnapshot,
  after: BusinessTableSnapshot,
): void {
  expect(after, "readOnly tool must not mutate any business table").toEqual(before);
}

// ─── Memory adapter ───────────────────────────────────────────────────────────

/**
 * Adapts the four in-memory service/repository instances from
 * memoryServices.ts into a BusinessSnapshotPort.
 *
 * Reads public array fields directly (tasks.tasks, blocks.blocks, etc.)
 * which are stable public API on the Memory* classes.
 */
export function memorySnapshotPort(deps: {
  taskService: MemoryTaskService;
  timeBlockService: MemoryTimeBlockService;
  confirmationRepo: MemoryConfirmationRepository;
  activeContextRepo: MemoryActiveContextRepository;
}): BusinessSnapshotPort {
  return {
    countTasks: async () => deps.taskService.tasks.length,
    countTimeBlocks: async () => deps.timeBlockService.blocks.length,
    countConfirmations: async () => deps.confirmationRepo.records.length,
    countActiveContexts: async () => deps.activeContextRepo.records.length,
  };
}
