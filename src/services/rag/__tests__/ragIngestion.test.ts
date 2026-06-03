// ============================================================
// ragIngestion.test.ts — V3.8.1 RAG Knowledge Manager 测试套
//
// 不触达 Tauri 真 SQLite：通过 RagDb 接口注入一个内存假 DB，
// 仅实现 RagService 在本测试范围内会执行的 SQL 子集：
//   - BEGIN / COMMIT / ROLLBACK
//   - INSERT INTO rag_documents / rag_chunks
//   - UPDATE rag_documents SET status / trust_level / reviewed_at / ...
//   - SELECT * FROM rag_documents WHERE ...
//
// 覆盖维度（对应 V3.8.1 plan §6）：
//   1. 资料状态：默认 draft / retrieve 只返 active / archived 不召回
//   2. Policy：external_context 强制 draft / system_guidance UI 拒绝
//   3. Adapter 双门控：sourceTypesProvider 动态生效
//   4. 安全边界：RagIngestionService 不 import ToolRouter / tasks / time_blocks
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { RagService } from "@/services/rag/RagService";
import type { RagDb } from "@/services/rag/RagService";
import {
  RagIngestionService,
  validateSourceTypePolicy,
} from "@/services/rag/RagIngestionService";
import { SqliteRagAdapter } from "@/agent/memory/SqliteRagAdapter";
import type {
  IngestDocumentInput,
  RagDocument,
  RagSourceType,
  RagStatus,
} from "@/types/rag.types";
import ragIngestionSource from "@/services/rag/RagIngestionService.ts?raw";
import ragKnowledgeStoreSource from "@/store/ragKnowledgeStore.ts?raw";

// ─── 内存假 DB（只覆盖 RagService 用到的 SQL 子集） ───────────────────────────

interface FakeDocRow {
  id: string;
  source_type: RagSourceType;
  title: string;
  summary: string | null;
  source_ref: string | null;
  tags_json: string;
  metadata_json: string | null;
  status: RagStatus;
  trust_level: "low" | "medium" | "high";
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface FakeChunkRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  tags_json: string;
  source_ref: string | null;
  metadata_json: string | null;
  token_count: number | null;
  created_at: string;
}

function buildFakeDb(): RagDb & {
  docs: FakeDocRow[];
  chunks: FakeChunkRow[];
} {
  const docs: FakeDocRow[] = [];
  const chunks: FakeChunkRow[] = [];

  const db: RagDb & { docs: FakeDocRow[]; chunks: FakeChunkRow[] } = {
    docs,
    chunks,

    async execute(sql: string, params: unknown[] = []) {
      const s = sql.trim().toUpperCase();

      if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
        return {};
      }

      if (s.startsWith("INSERT INTO RAG_DOCUMENTS")) {
        // 顺序：id, source_type, title, summary, source_ref, tags_json,
        //       metadata_json, status, trust_level, reviewed_at, created_at(=updated_at)
        const [
          id, sourceType, title, summary, sourceRef, tagsJson,
          metadataJson, status, trustLevel, reviewedAt, createdAt,
        ] = params as [
          string, RagSourceType, string, string | null, string | null, string,
          string | null, RagStatus, "low" | "medium" | "high", string | null, string,
        ];
        docs.push({
          id,
          source_type: sourceType,
          title,
          summary,
          source_ref: sourceRef,
          tags_json: tagsJson,
          metadata_json: metadataJson,
          status,
          trust_level: trustLevel,
          reviewed_at: reviewedAt,
          created_at: createdAt,
          updated_at: createdAt,
          deleted_at: null,
        });
        return {};
      }

      if (s.startsWith("INSERT INTO RAG_CHUNKS")) {
        const [
          id, documentId, chunkIndex, content, tagsJson, sourceRef,
          metadataJson, tokenCount, createdAt,
        ] = params as [
          string, string, number, string, string, string | null,
          string | null, number | null, string,
        ];
        chunks.push({
          id,
          document_id: documentId,
          chunk_index: chunkIndex,
          content,
          tags_json: tagsJson,
          source_ref: sourceRef,
          metadata_json: metadataJson,
          token_count: tokenCount,
          created_at: createdAt,
        });
        return {};
      }

      // UPDATE rag_documents SET status='active', reviewed_at=$1, updated_at=$1 WHERE id=$2 AND ...
      if (s.startsWith("UPDATE RAG_DOCUMENTS")) {
        // 简化策略：根据 SQL 关键字判断意图，从 params 末尾取 id 与 timestamp。
        const lastId = params[params.length - 1] as string;
        const target = docs.find((d) => d.id === lastId && d.deleted_at === null);
        if (!target) return {};
        if (s.includes("STATUS = 'ACTIVE'")) {
          target.status = "active";
          target.reviewed_at = params[0] as string;
          target.updated_at = params[0] as string;
        } else if (s.includes("STATUS = 'ARCHIVED'")) {
          target.status = "archived";
          target.updated_at = params[0] as string;
        } else if (s.includes("DELETED_AT") && s.includes("UPDATED_AT")) {
          // softDelete: UPDATE ... SET deleted_at = $1, updated_at = $1 WHERE id = $2
          target.deleted_at = params[0] as string;
          target.updated_at = params[0] as string;
        }
        return {};
      }

      return {};
    },

    async select<T>(sql: string, params: unknown[] = []): Promise<T> {
      const s = sql.trim().toUpperCase();

      // SELECT * FROM rag_documents WHERE id = $1 AND deleted_at IS NULL
      if (s.startsWith("SELECT * FROM RAG_DOCUMENTS WHERE ID")) {
        const id = params[0] as string;
        const found = docs.find((d) => d.id === id && d.deleted_at === null);
        return (found ? [found] : []) as T;
      }

      // SELECT * FROM rag_documents [WHERE ...] ORDER BY ...
      if (s.startsWith("SELECT * FROM RAG_DOCUMENTS")) {
        let rows = docs.slice();
        // 简化：根据 sql 含的关键字过滤
        const includeDeleted = !s.includes("DELETED_AT IS NULL");
        if (!includeDeleted) rows = rows.filter((d) => d.deleted_at === null);
        // 提取 params 索引顺序：source_type? / status? / search(LIKE)
        let pi = 0;
        if (s.includes("SOURCE_TYPE = $")) {
          const st = params[pi++] as RagSourceType;
          rows = rows.filter((d) => d.source_type === st);
        }
        if (s.includes("STATUS = $")) {
          const ss = params[pi++] as RagStatus;
          rows = rows.filter((d) => d.status === ss);
        }
        if (s.includes("TITLE LIKE")) {
          const raw = params[pi++] as string;
          pi++;
          const kw = raw.replace(/%/g, "").toLowerCase();
          rows = rows.filter(
            (d) =>
              d.title.toLowerCase().includes(kw) ||
              (d.summary?.toLowerCase().includes(kw) ?? false),
          );
        }
        rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return rows as T;
      }

      // SELECT c.*, d.source_type AS doc_source_type FROM rag_chunks c JOIN rag_documents d ...
      if (s.includes("FROM RAG_CHUNKS C") && s.includes("JOIN RAG_DOCUMENTS D")) {
        let rows = chunks.slice();
        // sourceTypes 过滤
        const sourceTypesInClause = s.match(/D\.SOURCE_TYPE IN \(([^)]*)\)/);
        let paramIdx = 0;
        if (sourceTypesInClause) {
          const count = (sourceTypesInClause[1].match(/\$/g) ?? []).length;
          const allowed = params.slice(paramIdx, paramIdx + count) as RagSourceType[];
          paramIdx += count;
          rows = rows.filter((c) => {
            const doc = docs.find((d) => d.id === c.document_id);
            return doc && allowed.includes(doc.source_type);
          });
        }
        // status='active' 硬过滤（默认）
        const activeOnly = s.includes("D.STATUS = 'ACTIVE'");
        rows = rows.filter((c) => {
          const doc = docs.find((d) => d.id === c.document_id);
          if (!doc || doc.deleted_at) return false;
          if (activeOnly && doc.status !== "active") return false;
          return true;
        });
        // LIKE 任一 token：剩下 params 是 like 关键字
        const likeKws = params.slice(paramIdx) as string[];
        if (likeKws.length > 0) {
          rows = rows.filter((c) =>
            likeKws.some((kw) => c.content.includes(kw.replace(/%/g, ""))),
          );
        }
        // 给 JOIN 的额外字段
        return rows.map((c) => {
          const doc = docs.find((d) => d.id === c.document_id)!;
          return { ...c, doc_source_type: doc.source_type };
        }) as T;
      }

      return [] as T;
    },
  };

  return db;
}

// ─── validateSourceTypePolicy ──────────────────────────────────────────────

describe("validateSourceTypePolicy", () => {
  it("system_guidance + actor=ui → 拒绝", () => {
    const r = validateSourceTypePolicy("system_guidance", "create", "ui");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("system_guidance");
  });

  it("system_guidance + actor=system → 通过", () => {
    const r = validateSourceTypePolicy("system_guidance", "create", "system");
    expect(r.ok).toBe(true);
  });

  it("external_context + create → 强制 draft", () => {
    const r = validateSourceTypePolicy("external_context", "create", "ui");
    expect(r.ok).toBe(true);
    expect(r.forcedStatus).toBe("draft");
  });

  it("user_material / seed_knowledge 通过 UI policy", () => {
    for (const st of ["user_material", "seed_knowledge"] as const) {
      expect(validateSourceTypePolicy(st, "create", "ui").ok).toBe(true);
      expect(validateSourceTypePolicy(st, "activate", "ui").ok).toBe(true);
    }
  });

  it("memory_summary 仅允许 system actor，UI 路径拒绝", () => {
    expect(validateSourceTypePolicy("memory_summary", "create", "ui").ok).toBe(false);
    expect(validateSourceTypePolicy("memory_summary", "activate", "ui").ok).toBe(false);
    expect(validateSourceTypePolicy("memory_summary", "create", "system").ok).toBe(true);
  });
});

// ─── 资料状态：默认 draft / retrieve 只返 active ─────────────────────────────

describe("RagIngestionService 资料状态", () => {
  it("createDraftDocument 默认入库 status='draft'", async () => {
    const db = buildFakeDb();
    const ingestion = new RagIngestionService(new RagService(db));

    const doc = await ingestion.createDraftDocument({
      sourceType: "user_material",
      title: "学习心理学",
      fullText: "这是一段用户录入的资料。",
    });

    expect(doc.status).toBe("draft");
    expect(db.docs[0].status).toBe("draft");
  });

  it("user_material 入参 status='active' 仍是 draft（UI 路径强制走 draft）", async () => {
    const db = buildFakeDb();
    const ingestion = new RagIngestionService(new RagService(db));
    const doc = await ingestion.createDraftDocument({
      sourceType: "user_material",
      title: "试图直接 active",
      fullText: "测试内容",
      status: "active",
    });
    expect(doc.status).toBe("draft");
  });

  it("external_context 即便没传 status 也被 Policy 强制为 draft", async () => {
    const db = buildFakeDb();
    const ingestion = new RagIngestionService(new RagService(db));
    const doc = await ingestion.createDraftDocument({
      sourceType: "external_context",
      title: "群通知摘要",
      fullText: "课程通知：下周三停课。",
    });
    expect(doc.status).toBe("draft");
  });

  it("activateDocument 把 status 推到 active 并写 reviewed_at", async () => {
    const db = buildFakeDb();
    const ingestion = new RagIngestionService(new RagService(db));
    const doc = await ingestion.createDraftDocument({
      sourceType: "user_material",
      title: "需要审核",
      fullText: "...",
    });
    await ingestion.activateDocument(doc.id);
    expect(db.docs[0].status).toBe("active");
    expect(db.docs[0].reviewed_at).toBeTruthy();
  });

  it("activateDocument 后刷新该文档 embedding", async () => {
    const db = buildFakeDb();
    const indexer = {
      refreshEmbeddingForDocument: vi.fn(async () => undefined),
    };
    const ingestion = new RagIngestionService(new RagService(db), indexer);
    const doc = await ingestion.createDraftDocument({
      sourceType: "user_material",
      title: "需要建索引",
      fullText: "番茄工作法",
    });

    await ingestion.activateDocument(doc.id);

    expect(indexer.refreshEmbeddingForDocument).toHaveBeenCalledWith(doc.id);
  });

  it("archiveDocument 把 status 推到 archived", async () => {
    const db = buildFakeDb();
    const ingestion = new RagIngestionService(new RagService(db));
    const doc = await ingestion.createDraftDocument({
      sourceType: "user_material",
      title: "归档",
      fullText: "...",
    });
    await ingestion.archiveDocument(doc.id);
    expect(db.docs[0].status).toBe("archived");
  });

  it("UI 路径激活 system_guidance → 抛错；不写库", async () => {
    const db = buildFakeDb();
    const rag = new RagService(db);
    // 直接通过底层 RagService 写入一条 system_guidance（模拟未来 system 路径）
    await rag.ingestDocument({
      sourceType: "system_guidance",
      title: "系统指引",
      fullText: "...",
      status: "draft",
    });
    const id = db.docs[0].id;
    const beforeStatus = db.docs[0].status;

    const ingestion = new RagIngestionService(rag);
    await expect(ingestion.activateDocument(id)).rejects.toThrow(/system_guidance/);
    // 未变更
    expect(db.docs[0].status).toBe(beforeStatus);
  });

  it("UI 路径创建 system_guidance → 抛错；不写库", async () => {
    const db = buildFakeDb();
    const ingestion = new RagIngestionService(new RagService(db));
    await expect(
      ingestion.createDraftDocument({
        sourceType: "system_guidance",
        title: "系统指引",
        fullText: "...",
      } as IngestDocumentInput),
    ).rejects.toThrow(/system_guidance/);
    expect(db.docs).toHaveLength(0);
  });
});

// ─── retrieve 默认只返 active ─────────────────────────────────────────────

describe("RagService.retrieve 默认 status='active' 硬过滤", () => {
  async function seedDocsWithStatuses(): Promise<{
    db: ReturnType<typeof buildFakeDb>;
    rag: RagService;
    ids: Record<RagStatus, string>;
  }> {
    const db = buildFakeDb();
    const rag = new RagService(db);
    const docs: Record<RagStatus, RagDocument> = {} as never;
    for (const status of ["draft", "active", "archived"] as RagStatus[]) {
      docs[status] = await rag.ingestDocument({
        sourceType: "user_material",
        title: `测试-${status}`,
        fullText: "番茄工作法核心是固定专注单元",
        status,
      });
    }
    return {
      db,
      rag,
      ids: {
        draft: docs.draft.id,
        active: docs.active.id,
        archived: docs.archived.id,
      },
    };
  }

  it("默认调用 retrieve 只返回 active 文档", async () => {
    const { rag, ids } = await seedDocsWithStatuses();
    const hits = await rag.retrieve("番茄");
    const docIds = hits.map((h) => h.documentId);
    expect(docIds).toContain(ids.active);
    expect(docIds).not.toContain(ids.draft);
    expect(docIds).not.toContain(ids.archived);
  });

  it("includeNonActive=true 时 draft 与 archived 也会返回", async () => {
    const { rag, ids } = await seedDocsWithStatuses();
    const hits = await rag.retrieve("番茄", { includeNonActive: true });
    const docIds = hits.map((h) => h.documentId);
    expect(docIds).toEqual(expect.arrayContaining([ids.active, ids.draft, ids.archived]));
  });
});

// ─── Adapter sourceTypesProvider 动态生效 ─────────────────────────────────

describe("SqliteRagAdapter.sourceTypesProvider 双门控配合", () => {
  it("provider 返回不同 sourceTypes 时 retrieve 收到的过滤集合一致变化", async () => {
    const observed: Array<readonly RagSourceType[] | undefined> = [];
    const mockService = {
      retrieve: async (_q: string, opts?: { sourceTypes?: RagSourceType[] }) => {
        observed.push(opts?.sourceTypes ? [...opts.sourceTypes] : undefined);
        return [];
      },
    } as unknown as RagService;

    let allowUserMaterial = false;
    const adapter = new SqliteRagAdapter({
      service: mockService,
      defaultSourceTypes: ["seed_knowledge"],
      sourceTypesProvider: () =>
        allowUserMaterial
          ? ["seed_knowledge", "user_material"]
          : ["seed_knowledge"],
    });

    await adapter.retrieveRelatedHistory("番茄");
    allowUserMaterial = true;
    await adapter.retrieveRelatedHistory("番茄");

    expect(observed[0]).toEqual(["seed_knowledge"]);
    expect(observed[1]).toEqual(["seed_knowledge", "user_material"]);
  });

  it("provider 抛错时降级到 defaultSourceTypes，不打断主响应", async () => {
    const captured: RagSourceType[] = [];
    const mockService = {
      retrieve: async (_q: string, opts?: { sourceTypes?: RagSourceType[] }) => {
        if (opts?.sourceTypes) captured.push(...opts.sourceTypes);
        return [];
      },
    } as unknown as RagService;

    const adapter = new SqliteRagAdapter({
      service: mockService,
      defaultSourceTypes: ["seed_knowledge"],
      sourceTypesProvider: () => {
        throw new Error("boom");
      },
    });

    await adapter.retrieveRelatedHistory("番茄");
    expect(captured).toEqual(["seed_knowledge"]);
  });
});

// ─── 安全边界回归：源码静态扫描 ───────────────────────────────────────────

describe("RagIngestionService 静态安全边界", () => {
  /** 只校验真实 import 语句，不会被注释/JSDoc 提及触发。 */
  function importsOf(source: string): string[] {
    return Array.from(source.matchAll(/import[^;]*?from\s+["']([^"']+)["']/g)).map((m) => m[1]);
  }

  it("RagIngestionService.ts 没有 import ToolRouter / 任务/时间块业务 Service", () => {
    const imports = importsOf(ragIngestionSource);
    for (const imp of imports) {
      expect(imp).not.toMatch(/ToolRouter/i);
      expect(imp).not.toMatch(/@\/services\/TaskService$/);
      expect(imp).not.toMatch(/@\/services\/TimeBlockService$/);
      expect(imp).not.toMatch(/@\/services\/ScheduleService$/);
    }
  });

  it("ragKnowledgeStore.ts 没有 import 业务 Service / ToolRouter", () => {
    const imports = importsOf(ragKnowledgeStoreSource);
    for (const imp of imports) {
      expect(imp).not.toMatch(/ToolRouter/i);
      expect(imp).not.toMatch(/TaskService/);
      expect(imp).not.toMatch(/TimeBlockService/);
      expect(imp).not.toMatch(/ScheduleService/);
    }
  });
});

// ─── chatStore 默认仍只检索 seed_knowledge ───────────────────────────────

describe("chatStore 默认 sourceTypes", () => {
  it("ragKnowledgeStore.userMaterialInChatEnabled 默认为 false", async () => {
    // 在 jsdom/node 环境下 localStorage 可能不存在/未设置，应默认 false。
    vi.resetModules();
    const { useRagKnowledgeStore } = await import("@/store/ragKnowledgeStore");
    const enabled = useRagKnowledgeStore.getState().userMaterialInChatEnabled;
    expect(enabled).toBe(false);
  });
});
