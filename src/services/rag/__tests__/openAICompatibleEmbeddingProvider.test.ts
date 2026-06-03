// ============================================================
// openAICompatibleEmbeddingProvider.test.ts — V3.8.7 fetch mock
// ============================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleEmbeddingProvider } from "@/services/rag/embedding/OpenAICompatibleEmbeddingProvider";

describe("OpenAICompatibleEmbeddingProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("缺 apiKey 返回零向量且不抛", async () => {
    const p = new OpenAICompatibleEmbeddingProvider({
      model: "text-embedding-3-small",
      version: "v1",
      dimensions: 4,
    });
    const vec = await p.embed("hello");
    expect(vec).toEqual([0, 0, 0, 0]);
    const d = p.describe();
    expect(d.externalApiEnabled).toBe(false);
    expect(JSON.stringify(d)).not.toMatch(/apiKey|sk-/i);
  });

  it("embedBatch 一次请求映射顺序", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const p = new OpenAICompatibleEmbeddingProvider({
      model: "m",
      version: "v1",
      dimensions: 2,
      apiKey: "sk-test",
    });
    const batch = await p.embedBatch(["a", "b"]);
    expect(batch).toHaveLength(2);
    expect(batch[0]).toEqual([0.1, 0.2]);
    expect(batch[1]).toEqual([0.3, 0.4]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    const body = JSON.parse(String(firstCall?.[1]?.body ?? "{}"));
    expect(body.input).toEqual(["a", "b"]);
  });
});
