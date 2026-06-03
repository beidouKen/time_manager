// ============================================================
// ragDemoLibrary.test.ts — V3.8.2 Local Coze-like RAG Demo Library
// ============================================================

import { describe, expect, it } from "vitest";
import { RagService } from "@/services/rag/RagService";
import { RagDemoLibraryService } from "@/services/rag/RagDemoLibraryService";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import ragDemoLibrarySource from "@/services/rag/RagDemoLibraryService.ts?raw";

async function seedLibrary(db: ReturnType<typeof buildFakeDb>) {
  const rag = new RagService(db);

  await rag.ingestDocument({
    sourceType: "seed_knowledge",
    title: "番茄工作法",
    fullText: "番茄工作法核心是固定专注单元",
    status: "active",
    trustLevel: "high",
  });

  await rag.ingestDocument({
    sourceType: "user_material",
    title: "用户笔记",
    fullText: "用户笔记关于复习计划",
    status: "active",
    trustLevel: "medium",
  });

  await rag.ingestDocument({
    sourceType: "user_material",
    title: "草稿笔记",
    fullText: "不应被检索或导出",
    status: "draft",
  });

  await rag.ingestDocument({
    sourceType: "external_context",
    title: "群通知",
    fullText: "课程调整通知",
    status: "active",
  });

  await rag.ingestDocument({
    sourceType: "external_context",
    title: "外部草稿",
    fullText: "外部草稿",
    status: "draft",
  });

  await rag.ingestDocument({
    sourceType: "system_guidance",
    title: "系统指引",
    fullText: "内部指引",
    status: "active",
  });

  await rag.ingestDocument({
    sourceType: "memory_summary",
    title: "记忆摘要",
    fullText: "用户习惯",
    status: "active",
  });

  await rag.ingestDocument({
    sourceType: "seed_knowledge",
    title: "已归档理论",
    fullText: "归档内容",
    status: "archived",
  });

  return rag;
}

describe("RagDemoLibraryService.getStats", () => {
  it("统计 active/draft/archived、chunk 总数与 sourceType 分布", async () => {
    const db = buildFakeDb();
    const demo = new RagDemoLibraryService(await seedLibrary(db));

    const stats = await demo.getStats();

    expect(stats.totalDocuments).toBe(8);
    expect(stats.activeCount).toBe(5);
    expect(stats.draftCount).toBe(2);
    expect(stats.archivedCount).toBe(1);
    expect(stats.totalChunks).toBeGreaterThanOrEqual(8);
    expect(stats.bySourceType.seed_knowledge).toBe(2);
    expect(stats.bySourceType.user_material).toBe(2);
    expect(stats.bySourceType.external_context).toBe(2);
    expect(stats.bySourceType.system_guidance).toBe(1);
    expect(stats.bySourceType.memory_summary).toBe(1);
  });
});

describe("RagDemoLibraryService.previewRetrieve", () => {
  it("只返回 active 文档命中，且包含 documentId/title/sourceType/score/content", async () => {
    const db = buildFakeDb();
    const demo = new RagDemoLibraryService(await seedLibrary(db));

    const hits = await demo.previewRetrieve("番茄", {
      sourceTypes: ["seed_knowledge"],
      limit: 5,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].documentId).toBeTruthy();
    expect(hits[0].title).toContain("番茄");
    expect(hits[0].sourceType).toBe("seed_knowledge");
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].content.length).toBeGreaterThan(0);
  });

  it("draft 文档不会被 retrieve 召回", async () => {
    const db = buildFakeDb();
    const demo = new RagDemoLibraryService(await seedLibrary(db));

    const hits = await demo.previewRetrieve("不应被检索", {
      sourceTypes: ["user_material"],
    });

    expect(hits).toHaveLength(0);
  });

  it("sourceTypes 过滤生效", async () => {
    const db = buildFakeDb();
    const demo = new RagDemoLibraryService(await seedLibrary(db));

    const seedOnly = await demo.previewRetrieve("课程", {
      sourceTypes: ["seed_knowledge"],
    });
    const extOnly = await demo.previewRetrieve("课程", {
      sourceTypes: ["external_context"],
    });

    expect(seedOnly.every((h) => h.sourceType === "seed_knowledge")).toBe(true);
    expect(extOnly.every((h) => h.sourceType === "external_context")).toBe(true);
  });
});

describe("RagDemoLibraryService.buildCozeLikeDatasetPreview", () => {
  it("默认导出 active 的 seed_knowledge 与 user_material", async () => {
    const db = buildFakeDb();
    const demo = new RagDemoLibraryService(await seedLibrary(db));

    const preview = await demo.buildCozeLikeDatasetPreview();

    const types = preview.dataset.documents.map((d) => d.sourceType);
    expect(types).toContain("seed_knowledge");
    expect(types).toContain("user_material");
    expect(types).not.toContain("external_context");
    expect(types).not.toContain("system_guidance");
    expect(types).not.toContain("memory_summary");
    expect(preview.dataset.documents.every((d) => d.status === "active")).toBe(true);
    expect(preview.dataset.documents.some((d) => d.title === "草稿笔记")).toBe(false);
    expect(preview.dataset.documents.some((d) => d.title === "已归档理论")).toBe(false);
  });

  it("system_guidance / memory_summary 写入 excludedReason", async () => {
    const db = buildFakeDb();
    const demo = new RagDemoLibraryService(await seedLibrary(db));

    const preview = await demo.buildCozeLikeDatasetPreview();

    expect(preview.meta.excludedReason.system_guidance).toBeTruthy();
    expect(preview.meta.excludedReason.memory_summary).toBeTruthy();
  });

  it("includeExternalContext=true 时导出 active external_context", async () => {
    const db = buildFakeDb();
    const demo = new RagDemoLibraryService(await seedLibrary(db));

    const preview = await demo.buildCozeLikeDatasetPreview({
      includeExternalContext: true,
    });

    const titles = preview.dataset.documents.map((d) => d.title);
    expect(titles).toContain("群通知");
    expect(titles).not.toContain("外部草稿");
    expect(preview.meta.includedSourceTypes).toContain("external_context");
  });

  it("includeUserMaterial=false 时排除 user_material", async () => {
    const db = buildFakeDb();
    const demo = new RagDemoLibraryService(await seedLibrary(db));

    const preview = await demo.buildCozeLikeDatasetPreview({
      includeUserMaterial: false,
    });

    expect(
      preview.dataset.documents.every((d) => d.sourceType !== "user_material"),
    ).toBe(true);
  });

  it("导出文档 content 由 chunks 拼合", async () => {
    const db = buildFakeDb();
    const rag = await seedLibrary(db);
    const demo = new RagDemoLibraryService(rag);

    const preview = await demo.buildCozeLikeDatasetPreview();
    const tomato = preview.dataset.documents.find((d) => d.title === "番茄工作法");
    expect(tomato?.content).toContain("番茄工作法");
  });
});

describe("RagDemoLibraryService 静态安全边界", () => {
  it("不 import ToolRouter / 业务 Service", () => {
    expect(ragDemoLibrarySource).not.toMatch(/from\s+["']@\/agent\/ToolRouter["']/);
    expect(ragDemoLibrarySource).not.toMatch(/from\s+["']@\/services\/TaskService["']/);
    expect(ragDemoLibrarySource).not.toMatch(/from\s+["']@\/services\/TimeBlockService["']/);
    expect(ragDemoLibrarySource).not.toMatch(/from\s+["']@\/services\/ScheduleService["']/);
  });
});
