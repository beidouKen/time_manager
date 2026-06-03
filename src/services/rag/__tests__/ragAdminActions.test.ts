// ============================================================
// ragAdminActions.test.ts — V3.8.6 RagAdminActions
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { RagAdminActions } from "@/services/rag/admin/RagAdminActions";
import type { RagEngine } from "@/services/rag/engine/RagEngine";
import { markSuccess, newJob } from "@/services/rag/indexing/RagIndexJob";

function mockEngine(): RagEngine {
  return {
    rebuildIndexes: vi.fn(async () => [
      markSuccess(newJob("keyword_rebuild"), 1, "fts"),
      markSuccess(newJob("vector_rebuild"), 2, "vec"),
    ]),
    rebuildKeywordIndex: vi.fn(async () =>
      markSuccess(newJob("keyword_rebuild"), 1, "fts"),
    ),
    rebuildVectorIndex: vi.fn(async () =>
      markSuccess(newJob("vector_rebuild"), 2, "vec"),
    ),
    healthCheck: vi.fn(async () => ({
      ok: true,
      mode: "self_hosted" as const,
      keyword: { ok: true, backend: "fts" },
      vector: { ok: true, backend: "vec" },
    })),
    evaluate: vi.fn(async () => ({
      totalCases: 1,
      matchedCount: 1,
      hitAtK: 1,
      sourceTypeMatchRate: 1,
      titleMatchRate: 1,
      averageTopScore: 0.9,
      perCase: [{ id: "q", query: "q", matched: true }],
    })),
    evaluateDefault: vi.fn(async () => ({
      totalCases: 5,
      matchedCount: 3,
      hitAtK: 0.6,
      sourceTypeMatchRate: 0.8,
      titleMatchRate: 0.5,
      averageTopScore: 0.7,
      perCase: [],
    })),
  } as unknown as RagEngine;
}

describe("RagAdminActions", () => {
  it("healthCheck 委托 engine", async () => {
    const engine = mockEngine();
    const admin = new RagAdminActions(engine);
    const h = await admin.healthCheck();
    expect(engine.healthCheck).toHaveBeenCalled();
    expect(h.ok).toBe(true);
  });

  it("rebuildAllIndexes 委托 engine", async () => {
    const engine = mockEngine();
    const admin = new RagAdminActions(engine);
    const jobs = await admin.rebuildAllIndexes();
    expect(engine.rebuildIndexes).toHaveBeenCalled();
    expect(jobs).toHaveLength(2);
  });

  it("rebuildKeywordIndex / rebuildVectorIndex 委托", async () => {
    const engine = mockEngine();
    const admin = new RagAdminActions(engine);
    await admin.rebuildKeywordIndex();
    await admin.rebuildVectorIndex();
    expect(engine.rebuildKeywordIndex).toHaveBeenCalled();
    expect(engine.rebuildVectorIndex).toHaveBeenCalled();
  });

  it("runEvaluation 委托 engine", async () => {
    const engine = mockEngine();
    const admin = new RagAdminActions(engine);
    const r = await admin.runEvaluation([{ id: "x", query: "番茄" }]);
    expect(engine.evaluate).toHaveBeenCalled();
    expect(r.hitAtK).toBe(1);
  });

  it("runDefaultEvaluation 委托 engine", async () => {
    const engine = mockEngine();
    const admin = new RagAdminActions(engine);
    const r = await admin.runDefaultEvaluation();
    expect(engine.evaluateDefault).toHaveBeenCalled();
    expect(r.totalCases).toBe(5);
  });
});
