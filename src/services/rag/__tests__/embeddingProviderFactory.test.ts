// ============================================================
// embeddingProviderFactory.test.ts — V3.8.7
// ============================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { DeterministicEmbeddingProvider } from "@/services/rag/embedding/DeterministicEmbeddingProvider";
import { OpenAICompatibleEmbeddingProvider } from "@/services/rag/embedding/OpenAICompatibleEmbeddingProvider";
import {
  createDefaultEmbeddingProvider,
  createEmbeddingProviderFromEnv,
  describeEmbeddingProvider,
  resolveEmbeddingProviderEnv,
} from "@/services/rag/embedding/embeddingProviderFactory";

describe("embeddingProviderFactory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("默认 deterministic", () => {
    vi.stubEnv("VITE_RAG_EMBEDDING_PROVIDER", "");
    const p = createDefaultEmbeddingProvider();
    expect(p).toBeInstanceOf(DeterministicEmbeddingProvider);
    const d = describeEmbeddingProvider(p);
    expect(d.externalApiEnabled).toBe(false);
  });

  it("openai_compatible 缺 key 时 fallback deterministic", () => {
    vi.stubEnv("VITE_RAG_EMBEDDING_PROVIDER", "openai_compatible");
    vi.stubEnv("VITE_RAG_EMBEDDING_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = createEmbeddingProviderFromEnv();
    expect(p).toBeInstanceOf(DeterministicEmbeddingProvider);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("openai_compatible 有 key 时创建 OpenAI provider", () => {
    vi.stubEnv("VITE_RAG_EMBEDDING_PROVIDER", "openai_compatible");
    vi.stubEnv("VITE_RAG_EMBEDDING_API_KEY", "sk-test");
    vi.stubEnv("VITE_RAG_EMBEDDING_MODEL", "text-embedding-3-small");
    const env = resolveEmbeddingProviderEnv();
    expect(env.provider).toBe("openai_compatible");
    const p = createEmbeddingProviderFromEnv(env);
    expect(p).toBeInstanceOf(OpenAICompatibleEmbeddingProvider);
    const d = describeEmbeddingProvider(p);
    expect(d.externalApiEnabled).toBe(true);
    expect(JSON.stringify(d)).not.toContain("sk-test");
  });
});
