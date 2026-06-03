// ============================================================
// memoryToRagBridge.test.ts — V3.8.7
// ============================================================

import { describe, expect, it } from "vitest";
import { MemoryToRagBridge } from "@/services/rag/memory/MemoryToRagBridge";
import { RagIngestionService } from "@/services/rag/RagIngestionService";
import { RagService } from "@/services/rag/RagService";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import bridgeSource from "@/services/rag/memory/MemoryToRagBridge.ts?raw";

describe("MemoryToRagBridge", () => {
  it("ui actor 被拒绝", async () => {
    const db = buildFakeDb();
    const bridge = new MemoryToRagBridge(new RagIngestionService(new RagService(db)));
    const draft = bridge.proposeMemorySummary({ recentMessages: ["hello"] });
    await expect(bridge.ingestMemorySummary(draft, "ui")).rejects.toThrow(
      /ui-write not allowed/,
    );
  });

  it("system actor 可创建 memory_summary draft", async () => {
    const db = buildFakeDb();
    const bridge = new MemoryToRagBridge(new RagIngestionService(new RagService(db)));
    const draft = bridge.proposeMemorySummary({
      recentMessages: ["完成了番茄钟"],
      selectedDate: "2026-05-31",
    });
    const v = bridge.validateMemorySummaryDraft(draft);
    expect(v.ok).toBe(true);
    const doc = await bridge.ingestMemorySummary(draft, "system");
    expect(doc.sourceType).toBe("memory_summary");
    expect(doc.status).toBe("draft");
  });

  it("validate 拒绝空 title", () => {
    const bridge = new MemoryToRagBridge(new RagIngestionService(new RagService(buildFakeDb())));
    const v = bridge.validateMemorySummaryDraft({
      title: "  ",
      summary: "s",
      fullText: "f",
    });
    expect(v.ok).toBe(false);
  });

  it("源码不含写库业务服务 import", () => {
    expect(bridgeSource).not.toMatch(/from ["']@\/.*ToolRouter/);
    expect(bridgeSource).not.toMatch(/from ["']@\/.*TaskService/);
    expect(bridgeSource).not.toMatch(/from ["']@\/.*TimeBlockService/);
    expect(bridgeSource).not.toMatch(/from ["']@\/.*ScheduleService/);
  });
});
