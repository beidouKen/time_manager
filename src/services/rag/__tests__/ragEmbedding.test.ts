// ============================================================
// ragEmbedding.test.ts — V3.8.3 DeterministicEmbedding + cosine
// ============================================================

import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "@/services/rag/embedding/cosineSimilarity";
import { DeterministicEmbeddingProvider } from "@/services/rag/embedding/DeterministicEmbeddingProvider";

describe("DeterministicEmbeddingProvider", () => {
  const provider = new DeterministicEmbeddingProvider();

  it("同文本两次 embed 完全相等", async () => {
    const a = await provider.embed("番茄工作法 专注");
    const b = await provider.embed("番茄工作法 专注");
    expect(a).toEqual(b);
  });

  it("不同文本输出不同向量", async () => {
    const a = await provider.embed("番茄工作法");
    const b = await provider.embed("甘特图 排期");
    expect(a).not.toEqual(b);
  });

  it("向量长度等于 dimensions (64)", async () => {
    const v = await provider.embed("test");
    expect(v.length).toBe(provider.dimensions);
    expect(provider.dimensions).toBe(64);
  });

  it("非空文本 L2 归一化（模长约 1）", async () => {
    const v = await provider.embed("专注 复习");
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("空文本返回零向量", async () => {
    const v = await provider.embed("   ");
    expect(v.every((x) => x === 0)).toBe(true);
  });
});

describe("cosineSimilarity", () => {
  it("相同向量相似度为 1", () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("正交向量相似度为 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("相反方向相似度为 -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("零向量与任意向量返回 0", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
