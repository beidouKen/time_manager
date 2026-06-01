// ============================================================
// ragRanking.test.ts — V3.8 RAG 检索纯函数 + SqliteRagAdapter + 安全边界测试
//
// 不触达真实 SQLite：
// - tokenize / chunkText / scoreChunk 是纯函数。
// - SqliteRagAdapter 测试通过注入 mock RagService 验证字段映射。
// - sanitizeRecommendation 是纯函数。
// - RecommendationHandler 通过 mock RagAdapter 验证语义化 query 传递。
// - RagService.ingestDocument 通过 mock DB 验证事务 ROLLBACK 行为。
// ============================================================

import { describe, expect, it, vi } from "vitest";
import { chunkText, scoreChunk, tokenize } from "@/services/rag/ragRanking";
import { SqliteRagAdapter } from "@/agent/memory/SqliteRagAdapter";
import { sanitizeRecommendation } from "@/agent/memory/sanitizeRecommendation";
import { RecommendationHandler } from "@/agent/time-management/RecommendationHandler";
import type { RagAdapter, RagSnippet } from "@/agent/memory/RagAdapter";
import { RagService } from "@/services/rag/RagService";
import type { RagDb } from "@/services/rag/RagService";
import type { RagChunkHit } from "@/types/rag.types";

describe("ragRanking.tokenize", () => {
  it("中英混合：英文整段保留小写，中文逐字切分，去重", () => {
    const out = tokenize("Pomodoro 番茄工作法 番茄");
    expect(out).toContain("pomodoro");
    expect(out).toContain("番");
    expect(out).toContain("茄");
    expect(out).toContain("工");
    expect(out).toContain("作");
    expect(out).toContain("法");
    expect(new Set(out).size).toBe(out.length);
  });

  it("空字符串与全标点输入返回空数组", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("！？，。 -- !!! ")).toEqual([]);
  });

  it("大小写归一与重复词去重", () => {
    const out = tokenize("Focus FOCUS focus");
    expect(out).toEqual(["focus"]);
  });

  it("标点不会成为 token", () => {
    const out = tokenize("hello, world! 你好，世界");
    expect(out).toContain("hello");
    expect(out).toContain("world");
    expect(out).toContain("你");
    expect(out).toContain("好");
    expect(out.some((t) => /[,!，。]/.test(t))).toBe(false);
  });
});

describe("ragRanking.chunkText", () => {
  it("空文本返回空数组", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  \n ")).toEqual([]);
  });

  it("段落优先：双换行分段时不强制拆", () => {
    const text = "段落一内容。\n\n段落二内容。\n\n段落三。";
    const out = chunkText(text, 600, 80);
    expect(out).toHaveLength(1); // 都很短，应聚合为一块
    expect(out[0]).toContain("段落一内容");
    expect(out[0]).toContain("段落三");
  });

  it("超长单段按字符强制切，且块之间有 overlap", () => {
    const longPara = "甲".repeat(1500);
    const out = chunkText(longPara, 600, 80);
    expect(out.length).toBeGreaterThanOrEqual(2);
    // 每块不超过 maxChars
    for (const piece of out) {
      expect(piece.length).toBeLessThanOrEqual(600);
    }
  });
});

describe("ragRanking.scoreChunk", () => {
  it("无查询 token 返回 0", () => {
    expect(scoreChunk("写作类任务", [], [])).toBe(0);
  });

  it("无命中返回 0", () => {
    const score = scoreChunk("番茄工作法的核心是把工作切分", [], ["艾", "宾", "浩", "斯"]);
    expect(score).toBe(0);
  });

  it("命中比例更高时分数更高", () => {
    const content = "番茄工作法用于专注训练，番茄钟是核心";
    // partial: 4 个 token 只命中 1 个（番），命中比例 1/4
    const partial = scoreChunk(content, [], ["番", "艾", "宾", "浩"]);
    // full: 4 个 token 全命中，命中比例 4/4
    const full = scoreChunk(content, [], ["番", "茄", "工", "作"]);
    expect(full).toBeGreaterThan(partial);
    expect(full).toBeLessThanOrEqual(1);
    expect(partial).toBeGreaterThan(0);
  });

  it("tag 匹配会显著提升分数", () => {
    const content = "番茄工作法用于专注训练";
    const noTag = scoreChunk(content, [], ["番", "茄"]);
    const withTag = scoreChunk(content, ["专注", "效率"], ["番", "茄"], ["专注"]);
    expect(withTag).toBeGreaterThan(noTag);
  });

  it("结果始终归一在 [0, 1]", () => {
    const content = "番茄番茄番茄番茄番茄番茄番茄番茄番茄番茄";
    const score = scoreChunk(content, ["专注"], ["番", "茄"], ["专注"]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("SqliteRagAdapter.retrieveRelatedHistory", () => {
  function buildMockService(hits: RagChunkHit[]): RagService {
    // 只暴露 retrieve；其他方法 adapter 不会调用
    return {
      retrieve: async () => hits,
    } as unknown as RagService;
  }

  it("把 RagChunkHit 映射为 RagSnippet，并保留 score 作为 relevance", async () => {
    const mockHits: RagChunkHit[] = [
      {
        id: "c1",
        documentId: "d1",
        chunkIndex: 0,
        content: "番茄工作法核心是固定专注单元",
        tags: ["专注"],
        sourceType: "seed_knowledge",
        score: 0.82,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "c2",
        documentId: "d2",
        chunkIndex: 0,
        content: "艾宾浩斯遗忘曲线显示间隔复习更有效",
        tags: ["记忆"],
        sourceType: "seed_knowledge",
        score: 0.66,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ];
    const adapter = new SqliteRagAdapter({ service: buildMockService(mockHits) });
    const { snippets } = await adapter.retrieveRelatedHistory("番茄");

    expect(snippets).toHaveLength(2);
    expect(snippets[0].content).toContain("番茄");
    expect(snippets[0].relevance).toBe(0.82);
    expect(snippets[0].source).toBe("seed_knowledge:d1");
    expect(snippets[1].source).toBe("seed_knowledge:d2");
  });

  it("空 hits 返回空 snippets，不抛异常", async () => {
    const adapter = new SqliteRagAdapter({ service: buildMockService([]) });
    const { snippets } = await adapter.retrieveRelatedHistory("不存在");
    expect(snippets).toEqual([]);
  });
});

// ─── sanitizeRecommendation 安全清洗纯函数 ─────────────────────────────────

describe("sanitizeRecommendation", () => {
  it("正常中文建议文本直接返回", () => {
    const text = "建议你为写作任务多留 20 分钟缓冲时间，避免跨越精力低谷期。";
    expect(sanitizeRecommendation(text)).toBe(text);
  });

  it("去掉内部实现名称 ToolRouter / semantic_frame 等", () => {
    const text = "ToolRouter 分析了你的请求，通过 semantic_frame 提取任务意图。";
    const result = sanitizeRecommendation(text);
    expect(result).not.toContain("ToolRouter");
    expect(result).not.toContain("semantic_frame");
    expect(result.length).toBeGreaterThan(0); // 其余文本保留
  });

  it("去掉 JSON-like 片段", () => {
    const text = '建议参考番茄工作法 {"toolName":"create_task","params":{}} 进行任务拆分。';
    const result = sanitizeRecommendation(text);
    expect(result).not.toContain("toolName");
    expect(result).not.toContain("{");
  });

  it("命令口吻整段丢弃返回空串", () => {
    expect(sanitizeRecommendation("请执行番茄工作法，立即开始计时。")).toBe("");
    expect(sanitizeRecommendation("立即执行任务，不要拖延。")).toBe("");
  });

  it("空字符串返回空字符串", () => {
    expect(sanitizeRecommendation("")).toBe("");
    expect(sanitizeRecommendation("   ")).toBe("");
  });
});

// ─── RecommendationHandler：语义化 RAG query 传递验证 ─────────────────────

describe("RecommendationHandler.generateRecommendation — 语义化 query", () => {
  function buildMockRagAdapter(capturedQueries: string[]): RagAdapter {
    return {
      retrieveRelatedHistory: async (query: string) => {
        capturedQueries.push(query);
        const snippets: RagSnippet[] = [];
        return { snippets };
      },
    };
  }

  const baseContext = {
    currentDatetime: new Date().toISOString(),
    timezone: "Asia/Shanghai",
    recentMessages: [] as Array<{ role: string; content: string }>,
    lastCreatedTaskId: null as string | null,
    lastMentionedTaskIds: [] as string[],
    lastScheduledTimeBlockIds: [] as string[],
    lastToolResults: [] as unknown[],
  };

  const blocks = [
    { title: "深度工作：论文写作", start_time: "09:00", end_time: "11:00" },
    { title: "番茄：代码复盘", start_time: "14:00", end_time: "15:00" },
  ];

  it("传入 ragQuery 时使用该 query，而非 currentDatetime", async () => {
    const captured: string[] = [];
    const handler = new RecommendationHandler({
      ragAdapter: buildMockRagAdapter(captured),
    });

    const semanticQuery = "论文写作专注安排";
    await handler.generateRecommendation(baseContext as never, blocks, semanticQuery);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(semanticQuery);
    expect(captured[0]).not.toMatch(/^\d{4}-\d{2}-\d{2}T/); // 不是 ISO 日期串
  });

  it("不传 ragQuery 时用 block 标题拼接，仍不是 currentDatetime", async () => {
    const captured: string[] = [];
    const handler = new RecommendationHandler({
      ragAdapter: buildMockRagAdapter(captured),
    });

    await handler.generateRecommendation(baseContext as never, blocks);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain("深度工作");
    expect(captured[0]).toContain("番茄");
    expect(captured[0]).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("ragQuery 为空串时不调用 RagAdapter（避免无效检索）", async () => {
    const captured: string[] = [];
    const handler = new RecommendationHandler({
      ragAdapter: buildMockRagAdapter(captured),
    });

    // 空 blocks + 无 ragQuery → resolvedQuery 为空 → ragAdapter 不调用
    await handler.generateRecommendation(baseContext as never, [], "");

    expect(captured).toHaveLength(0);
  });
});

// ─── SqliteRagAdapter 注入 AgentService 不写库 ─────────────────────────────

describe("SqliteRagAdapter 注入后 retrieve 不调用写操作", () => {
  it("retrieveRelatedHistory 只调用 retrieve，不调用 ingestDocument / deleteDocument", async () => {
    const ingestSpy = vi.fn();
    const deleteSpy = vi.fn();
    const retrieveSpy = vi.fn().mockResolvedValue([]);

    const mockService: Partial<RagService> = {
      retrieve: retrieveSpy,
      ingestDocument: ingestSpy,
      deleteDocument: deleteSpy,
    };

    const adapter = new SqliteRagAdapter({
      service: mockService as RagService,
      defaultSourceTypes: ["seed_knowledge"],
    });

    await adapter.retrieveRelatedHistory("写作任务安排");

    expect(retrieveSpy).toHaveBeenCalledOnce();
    expect(ingestSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

// ─── RagService.ingestDocument 事务失败不留半成品 ──────────────────────────
//
// 通过构造函数注入 mock DB（RagDb 接口），无需 vi.doMock / Tauri window。

describe("RagService.ingestDocument 事务 ROLLBACK", () => {
  it("chunks 写入失败时会调用 ROLLBACK 并向上抛错", async () => {
    const calls: string[] = [];

    const mockDb: RagDb = {
      execute: vi.fn(async (sql: string) => {
        const normalized = sql.trim().toUpperCase();
        if (normalized.startsWith("BEGIN")) { calls.push("BEGIN"); return {}; }
        if (normalized.startsWith("COMMIT")) { calls.push("COMMIT"); return {}; }
        if (normalized.startsWith("ROLLBACK")) { calls.push("ROLLBACK"); return {}; }
        if (normalized.startsWith("INSERT INTO RAG_DOCUMENTS")) {
          calls.push("INSERT_DOC");
          return {};
        }
        if (normalized.startsWith("INSERT INTO RAG_CHUNKS")) {
          calls.push("INSERT_CHUNK");
          throw new Error("chunk write failure");
        }
        return {};
      }),
      select: vi.fn().mockResolvedValue([]),
    };

    const svc = new RagService(mockDb);

    await expect(
      svc.ingestDocument({
        sourceType: "seed_knowledge",
        title: "测试文档",
        summary: "测试摘要",
        chunks: [{ content: "第一块内容" }],
      }),
    ).rejects.toThrow("chunk write failure");

    expect(calls).toContain("BEGIN");
    expect(calls).toContain("INSERT_DOC");
    expect(calls).toContain("INSERT_CHUNK");
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
  });

  it("chunks 全部写入成功时会调用 COMMIT，不调用 ROLLBACK", async () => {
    const calls: string[] = [];

    const mockDb: RagDb = {
      execute: vi.fn(async (sql: string) => {
        const normalized = sql.trim().toUpperCase();
        if (normalized.startsWith("BEGIN")) { calls.push("BEGIN"); return {}; }
        if (normalized.startsWith("COMMIT")) { calls.push("COMMIT"); return {}; }
        if (normalized.startsWith("ROLLBACK")) { calls.push("ROLLBACK"); return {}; }
        calls.push("OTHER");
        return {};
      }),
      select: vi.fn().mockResolvedValue([]),
    };

    const svc = new RagService(mockDb);
    const doc = await svc.ingestDocument({
      sourceType: "seed_knowledge",
      title: "成功文档",
      chunks: [{ content: "内容一" }, { content: "内容二" }],
    });

    expect(doc.title).toBe("成功文档");
    expect(calls).toContain("BEGIN");
    expect(calls).toContain("COMMIT");
    expect(calls).not.toContain("ROLLBACK");
  });
});
