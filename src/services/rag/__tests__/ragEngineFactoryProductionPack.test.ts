// ============================================================
// ragEngineFactoryProductionPack.test.ts — V3.8.7
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { DeterministicEmbeddingProvider } from "@/services/rag/embedding/DeterministicEmbeddingProvider";
import { createRagEngine } from "@/services/rag/engine/RagEngineFactory";
import { DisabledVectorStore } from "@/services/rag/vector/DisabledVectorStore";
import * as embedFactory from "@/services/rag/embedding/embeddingProviderFactory";
import * as vsFactory from "@/services/rag/vector/VectorStoreFactory";

describe("RagEngineFactory production pack", () => {
  it("legacy 模式可 healthCheck", async () => {
    const engine = createRagEngine({ mode: "legacy" });
    const h = await engine.healthCheck();
    expect(h.mode).toBe("legacy");
  });

  it("self_hosted 模式可装配", async () => {
    const engine = createRagEngine({ mode: "self_hosted" });
    const h = await engine.healthCheck();
    expect(h.mode).toBe("self_hosted");
  });

  it("vector store 构造失败回退 disabled", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.spyOn(vsFactory, "createVectorStore");
    spy.mockImplementationOnce(() => {
      throw new Error("vs fail");
    });
    const engine = createRagEngine({ mode: "self_hosted", vectorBackend: "sqlite_json" });
    expect(engine).toBeDefined();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    warn.mockRestore();
  });

  it("embedding provider 构造失败时 factory 仍返回 engine", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.spyOn(embedFactory, "createDefaultEmbeddingProvider");
    spy.mockImplementationOnce(() => {
      throw new Error("embed fail");
    });
    const engine = createRagEngine({ mode: "legacy" });
    expect(engine).toBeDefined();
    spy.mockRestore();
    warn.mockRestore();
  });

  it("enableAdminActions 时引擎可创建且含 evaluation 路径", async () => {
    const engine = createRagEngine({
      mode: "legacy",
      enableAdminActions: true,
      enableEvaluation: false,
    });
    await expect(engine.evaluate([{ id: "t", query: "x" }])).rejects.toThrow();
    const h = await engine.healthCheck();
    expect(h.ok).toBeTruthy();
  });

  it("vectorBackend disabled 使用 DisabledVectorStore", () => {
    const vs = vsFactory.createVectorStore(
      "disabled",
      new DeterministicEmbeddingProvider(),
    );
    expect(vs).toBeInstanceOf(DisabledVectorStore);
  });
});
