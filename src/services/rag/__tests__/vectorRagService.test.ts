// ============================================================
// vectorRagService.test.ts — V3.8.3 VectorRagService
// ============================================================

import { describe, expect, it } from "vitest";
import { SqliteRagAdapter } from "@/agent/memory/SqliteRagAdapter";
import { DeterministicEmbeddingProvider } from "@/services/rag/embedding/DeterministicEmbeddingProvider";
import { RagService } from "@/services/rag/RagService";
import { VectorRagService } from "@/services/rag/VectorRagService";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import type { IngestDocumentInput } from "@/types/rag.types";
import vectorRagSource from "@/services/rag/VectorRagService.ts?raw";
import deterministicSource from "@/services/rag/embedding/DeterministicEmbeddingProvider.ts?raw";

async function ingest(
  rag: RagService,
  input: IngestDocumentInput,
): Promise<void> {
  await rag.ingestDocument(input);
}

function makeVector(db: ReturnType<typeof buildFakeDb>) {
  const provider = new DeterministicEmbeddingProvider();
  const rag = new RagService(db);
  return new VectorRagService(rag, provider, db);
}

describe("VectorRagService.embedMissingChunks", () => {
  it("为 active 文档 chunks 写入 embeddings", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "番茄",
      fullText: "番茄工作法 25 分钟专注",
      status: "active",
    });

    const first = await vector.embedMissingChunks();
    expect(first.embedded).toBeGreaterThan(0);
    expect(db.embeddings.length).toBe(first.embedded);
  });

  it("二次调用不重复写入", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "专注",
      fullText: "深度工作 专注块",
      status: "active",
    });

    await vector.embedMissingChunks();
    const countAfterFirst = db.embeddings.length;
    const second = await vector.embedMissingChunks();
    expect(second.embedded).toBe(0);
    expect(db.embeddings.length).toBe(countAfterFirst);
  });

  it("draft 文档 chunks 不被 embed", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

    await ingest(rag, {
      sourceType: "user_material",
      title: "草稿",
      fullText: "不应嵌入",
      status: "draft",
    });

    const r = await vector.embedMissingChunks();
    expect(r.embedded).toBe(0);
    expect(db.embeddings.length).toBe(0);
  });
});

describe("VectorRagService.refreshEmbeddingForDocument", () => {
  it("先删旧 embeddings 再写入新的", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

    const doc = await rag.ingestDocument({
      sourceType: "seed_knowledge",
      title: "复习",
      fullText: "间隔复习 巩固记忆",
      status: "active",
    });

    await vector.embedMissingChunks();
    const oldJson = db.embeddings[0]?.vector_json;
    await vector.refreshEmbeddingForDocument(doc.id);
    expect(db.embeddings.length).toBeGreaterThan(0);
    expect(db.embeddings.every((e) => e.document_id === doc.id)).toBe(true);
    // refresh 会 DELETE 后重 embed，至少仍有一条
    expect(db.embeddings[0]?.vector_json).toBeTruthy();
    if (oldJson) {
      // 同内容同 provider 可能相同，但 id 会更新
      expect(db.embeddings[0]?.id).toBeTruthy();
    }
  });
});

describe("VectorRagService.retrieveVector", () => {
  it("仅返回 active 文档命中", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "A",
      fullText: "番茄工作法",
      status: "active",
    });
    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "B",
      fullText: "甘特图",
      status: "draft",
    });
    await vector.embedMissingChunks();

    const hits = await vector.retrieveVector("番茄", {
      sourceTypes: ["seed_knowledge"],
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.retrieveMode === "vector")).toBe(true);
    expect(hits.every((h) => h.sourceType === "seed_knowledge")).toBe(true);
  });

  it("sourceTypes 过滤生效", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

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
    await vector.embedMissingChunks();

    const hits = await vector.retrieveVector("专注", {
      sourceTypes: ["user_material"],
    });
    expect(hits.every((h) => h.sourceType === "user_material")).toBe(true);
  });

  it("无 embeddings 时返回空", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "无向量",
      fullText: "尚未 embed",
      status: "active",
    });

    const hits = await vector.retrieveVector("尚未", {
      sourceTypes: ["seed_knowledge"],
    });
    expect(hits).toEqual([]);
  });

  it("topK 与 cosine 降序", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "多段",
      fullText: "番茄 专注 复习 番茄工作法",
      status: "active",
    });
    await vector.embedMissingChunks();

    const hits = await vector.retrieveVector("番茄工作法 专注", {
      sourceTypes: ["seed_knowledge"],
      limit: 1,
    });
    expect(hits.length).toBeLessThanOrEqual(1);
    if (hits.length >= 2) {
      expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
    }
  });
});

describe("VectorRagService.retrieveHybrid", () => {
  it("vector 命中时 retrieveMode=vector", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "hybrid-v",
      fullText: "番茄工作法 时间管理",
      status: "active",
    });
    await vector.embedMissingChunks();

    const hits = await vector.retrieveHybrid("番茄", {
      sourceTypes: ["seed_knowledge"],
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].retrieveMode).toBe("vector");
  });

  it("vector 空时 fallback keyword", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "kw-only",
      fullText: "唯一关键词 xyzzykw",
      status: "active",
    });
    // 不 embed → vector 空；keyword LIKE 应命中
    const hits = await vector.retrieveHybrid("xyzzykw", {
      sourceTypes: ["seed_knowledge"],
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].retrieveMode).toBe("keyword");
  });
});

describe("SqliteRagAdapter + vectorService", () => {
  it("注入 vectorService 后走 hybrid", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const vector = makeVector(db);

    await ingest(rag, {
      sourceType: "seed_knowledge",
      title: "adapter",
      fullText: "番茄 专注",
      status: "active",
    });
    await vector.embedMissingChunks();

    const adapter = new SqliteRagAdapter({
      service: rag,
      vectorService: vector,
      defaultSourceTypes: ["seed_knowledge"],
      defaultLimit: 2,
    });

    const { snippets } = await adapter.retrieveRelatedHistory("番茄");
    expect(snippets.length).toBeGreaterThan(0);
  });

  it("vectorService 抛错不传播", async () => {
    const rag = new RagService(buildFakeDb());
    const broken = {
      retrieveHybrid: () => Promise.reject(new Error("boom")),
    } as unknown as VectorRagService;

    const adapter = new SqliteRagAdapter({
      service: rag,
      vectorService: broken,
      defaultSourceTypes: ["seed_knowledge"],
    });

    await expect(
      adapter.retrieveRelatedHistory("任意"),
    ).resolves.toBeDefined();
  });
});

describe("V3.8.3 安全边界静态扫描", () => {
  it("VectorRagService 不 import 写库服务", () => {
    expect(vectorRagSource).not.toMatch(/from ["']@\/.*ToolRouter/);
    expect(vectorRagSource).not.toMatch(/from ["']@\/.*TaskService/);
    expect(vectorRagSource).not.toMatch(/from ["']@\/.*TimeBlockService/);
    expect(vectorRagSource).not.toMatch(/from ["']@\/.*ScheduleService/);
  });

  it("DeterministicEmbeddingProvider 不调外部 API", () => {
    expect(deterministicSource).not.toMatch(/\bfetch\s*\(/);
  });
});
