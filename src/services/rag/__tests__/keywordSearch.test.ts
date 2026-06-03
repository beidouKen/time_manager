// ============================================================
// keywordSearch.test.ts — V3.8.5 SqliteFtsKeywordSearch
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { SqliteFtsKeywordSearch } from "@/services/rag/keyword/SqliteFtsKeywordSearch";
import { RagService } from "@/services/rag/RagService";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import type { IngestDocumentInput } from "@/types/rag.types";

async function ingest(rag: RagService, input: IngestDocumentInput) {
  await rag.ingestDocument(input);
}

describe("SqliteFtsKeywordSearch", () => {
  it("只返回 active 文档", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const kw = new SqliteFtsKeywordSearch(rag, db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "番茄",
      fullText: "番茄工作法 专注",
      status: "active",
    });
    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "草稿",
      fullText: "番茄 草稿内容",
      status: "draft",
    });
    await kw.rebuildIndex?.();

    const hits = await kw.search("番茄", { sourceTypes: ["seed_knowledge"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.retrieveMode === "keyword")).toBe(true);
  });

  it("sourceTypes 过滤生效", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const kw = new SqliteFtsKeywordSearch(rag, db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "内置",
      fullText: "专注学习法",
      status: "active",
    });
    await ingest(rag, {
      sourceType: "user_material",
      title: "用户",
      fullText: "专注笔记",
      status: "active",
    });
    await kw.rebuildIndex?.();

    const hits = await kw.search("专注", { sourceTypes: ["user_material"] });
    expect(hits.every((h) => h.sourceType === "user_material")).toBe(true);
  });

  it("draft / archived 默认不返回", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const kw = new SqliteFtsKeywordSearch(rag, db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "归档",
      fullText: "唯一词 xyzzyarch",
      status: "active",
    });
    const draft = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "草稿唯一",
      fullText: "唯一词 xyzzyarch 草稿",
      status: "draft",
    });
    expect(draft.status).toBe("draft");
    await kw.rebuildIndex?.();

    const hits = await kw.search("xyzzyarch", { sourceTypes: ["seed_knowledge"] });
    const docIds = new Set(hits.map((h) => h.documentId));
    expect(docIds.has(draft.id)).toBe(false);
  });

  it("FTS 失败时 fallback 不抛出", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const kw = new SqliteFtsKeywordSearch(rag, db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "fallback",
      fullText: "番茄工作法",
      status: "active",
    });

    const orig = db.select.bind(db);
    db.select = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.toUpperCase().includes("RAG_CHUNKS_FTS") && sql.toUpperCase().includes("MATCH")) {
        throw new Error("FTS broken");
      }
      return orig(sql, params);
    }) as typeof db.select;

    await expect(
      kw.search("番茄", { sourceTypes: ["seed_knowledge"] }),
    ).resolves.toBeDefined();
  });
});
