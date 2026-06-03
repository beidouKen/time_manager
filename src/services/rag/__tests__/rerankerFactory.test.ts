// ============================================================
// rerankerFactory.test.ts — V3.8.7
// ============================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { NoopReranker } from "@/services/rag/rerank/Reranker";
import { ScoreReranker } from "@/services/rag/rerank/ScoreReranker";
import { createReranker } from "@/services/rag/rerank/RerankerFactory";

describe("RerankerFactory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("none 返回 NoopReranker", () => {
    expect(createReranker("none")).toBeInstanceOf(NoopReranker);
  });

  it("score 返回 ScoreReranker", () => {
    expect(createReranker("score")).toBeInstanceOf(ScoreReranker);
  });
});
