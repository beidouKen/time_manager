// ============================================================
// ragAdminUiActions.test.ts — V3.8.7
// ============================================================

import { describe, expect, it, vi } from "vitest";
import {
  getRagAdminActions,
  resetRagAdminActionsForTests,
} from "@/services/rag/admin/getRagAdminActions";
import { RagAdminActions } from "@/services/rag/admin/RagAdminActions";
import type { RagEngine } from "@/services/rag/engine/RagEngine";
import { markSuccess, newJob } from "@/services/rag/indexing/RagIndexJob";
import getAdminSource from "@/services/rag/admin/getRagAdminActions.ts?raw";

vi.mock("@/services/rag/engine/RagEngineFactory", () => ({
  createDefaultRagEngine: vi.fn(),
}));

import { createDefaultRagEngine } from "@/services/rag/engine/RagEngineFactory";

function mockEngine(): RagEngine {
  return {
    rebuildIndexes: vi.fn(async () => [markSuccess(newJob("keyword_rebuild"), 1)]),
    rebuildKeywordIndex: vi.fn(async () => markSuccess(newJob("keyword_rebuild"), 1)),
    rebuildVectorIndex: vi.fn(async () => markSuccess(newJob("vector_rebuild"), 2)),
    healthCheck: vi.fn(async () => ({
      ok: true,
      mode: "legacy" as const,
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
      perCase: [{ id: "x", query: "q", matched: true }],
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

describe("getRagAdminActions", () => {
  it("engine 失败返回 undefined", () => {
    resetRagAdminActionsForTests();
    vi.mocked(createDefaultRagEngine).mockReturnValue(undefined);
    expect(getRagAdminActions()).toBeUndefined();
  });

  it("成功时缓存 RagAdminActions", () => {
    resetRagAdminActionsForTests();
    vi.mocked(createDefaultRagEngine).mockReturnValue(mockEngine());
    const admin = getRagAdminActions();
    expect(admin).toBeInstanceOf(RagAdminActions);
    expect(getRagAdminActions()).toBe(admin);
  });

  it("runDefaultEvaluation 委托 engine", async () => {
    resetRagAdminActionsForTests();
    const engine = mockEngine();
    vi.mocked(createDefaultRagEngine).mockReturnValue(engine);
    const admin = getRagAdminActions()!;
    const r = await admin.runDefaultEvaluation();
    expect(engine.evaluateDefault).toHaveBeenCalled();
    expect(r.hitAtK).toBe(0.6);
  });

  it("源码不含 ToolRouter", () => {
    expect(getAdminSource).not.toMatch(/from ["']@\/.*ToolRouter/);
  });
});
