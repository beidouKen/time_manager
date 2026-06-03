// ============================================================
// SqliteRagAdapter.ts — V3.8 RAG 生产 Adapter
//
// 把 RagService 适配到现有的 RagAdapter 接口，让 RecommendationHandler
// 在不修改任何代码的前提下，从本地 RAG 表读取真实知识 snippet。
//
// 测试默认仍使用 MockRagAdapter，所以现有 75 条测试不受影响。
// 调用方（App 启动时）按需注入本类到 AgentService。
//
// 严格遵守 RagSnippet { content, relevance, source? } 形状。
// ============================================================

import type { RagAdapter, RagSnippet } from "@/agent/memory/RagAdapter";
import { RagService } from "@/services/rag/RagService";
import type { RagEngine } from "@/services/rag/engine/RagEngine";
import type { HybridRetriever } from "@/services/rag/retrieval/HybridRetriever";
import type { VectorRagService } from "@/services/rag/VectorRagService";
import type { RagSourceType } from "@/types/rag.types";

export interface SqliteRagAdapterOptions {
  /** 注入测试用 service；不传则内部 new RagService()。 */
  service?: RagService;
  /** 默认检索的 sourceType 过滤；不传则不过滤。 */
  defaultSourceTypes?: RagSourceType[];
  /**
   * V3.8.1：动态 sourceTypes 提供者。
   *
   * 若提供，则每次 retrieveRelatedHistory 调用时优先调用此函数获取当前允许的
   * sourceTypes（用于响应用户在 Settings 中开关 user_material 等运行时变化），
   * 不再使用 defaultSourceTypes。
   *
   * provider 返回空数组等价于 defaultSourceTypes 不过滤；返回非空数组则做硬过滤。
   * 如果 provider 抛错，会降级到 defaultSourceTypes，避免影响主响应。
   */
  sourceTypesProvider?: () => RagSourceType[];
  /** 默认返回 snippet 数量上限。 */
  defaultLimit?: number;
  /** 偏好 tags（影响排序加权，不影响过滤）。 */
  defaultPreferredTags?: string[];
  /** V3.8.3：可选向量服务；若提供则优先 hybrid retrieve。 */
  vectorService?: VectorRagService;
  /** V3.8.5：Self-hosted RAG Engine；优先于 vectorService。 */
  hybridRetriever?: HybridRetriever;
  /** V3.8.6：统一 RagEngine 入口；优先于 hybridRetriever。 */
  ragEngine?: RagEngine;
}

export class SqliteRagAdapter implements RagAdapter {
  private service: RagService;
  private defaultSourceTypes: RagSourceType[] | undefined;
  private sourceTypesProvider: (() => RagSourceType[]) | undefined;
  private defaultLimit: number;
  private defaultPreferredTags: string[] | undefined;
  private vectorService: VectorRagService | undefined;
  private hybridRetriever: HybridRetriever | undefined;
  private ragEngine: RagEngine | undefined;

  constructor(opts: SqliteRagAdapterOptions = {}) {
    this.service = opts.service ?? new RagService();
    this.defaultSourceTypes = opts.defaultSourceTypes;
    this.sourceTypesProvider = opts.sourceTypesProvider;
    this.defaultLimit = opts.defaultLimit ?? 3;
    this.defaultPreferredTags = opts.defaultPreferredTags;
    this.vectorService = opts.vectorService;
    this.hybridRetriever = opts.hybridRetriever;
    this.ragEngine = opts.ragEngine;
  }

  /** V3.8.1：每次检索解析当前生效的 sourceTypes。 */
  private resolveSourceTypes(): RagSourceType[] | undefined {
    if (!this.sourceTypesProvider) return this.defaultSourceTypes;
    try {
      const dynamic = this.sourceTypesProvider();
      if (Array.isArray(dynamic) && dynamic.length > 0) return dynamic;
      // provider 返回空数组 → 退回默认，避免无意中放开所有 sourceType
      return this.defaultSourceTypes;
    } catch {
      return this.defaultSourceTypes;
    }
  }

  async retrieveRelatedHistory(
    query: string,
  ): Promise<{ snippets: RagSnippet[] }> {
    const sourceTypes = this.resolveSourceTypes();
    const limit = this.defaultLimit;

    if (this.ragEngine) {
      try {
        const result = await this.ragEngine.retrieve(query, {
          sourceTypes,
          limit,
        });
        return { snippets: result.snippets };
      } catch {
        // engine 失败降级 hybrid / vector / keyword
      }
    }

    if (this.hybridRetriever) {
      try {
        const hits = await this.hybridRetriever.retrieve(query, {
          sourceTypes,
          limit,
        });
        const snippets: RagSnippet[] = hits.map((h) => ({
          content: h.content,
          relevance: h.score,
          source: `${h.sourceType}:${h.documentId}`,
        }));
        return { snippets };
      } catch {
        // self-hosted 失败降级 V3.8.3 / keyword
      }
    }

    if (this.vectorService) {
      try {
        const hits = await this.vectorService.retrieveHybrid(query, {
          sourceTypes,
          limit,
        });
        const snippets: RagSnippet[] = hits.map((h) => ({
          content: h.content,
          relevance: h.score,
          source: `${h.sourceType}:${h.documentId}`,
        }));
        return { snippets };
      } catch {
        // vector 失败降级 keyword，不阻塞主响应
      }
    }

    const hits = await this.service.retrieve(query, {
      sourceTypes,
      tags: this.defaultPreferredTags,
      limit,
    });

    const snippets: RagSnippet[] = hits.map((h) => ({
      content: h.content,
      relevance: h.score,
      source: `${h.sourceType}:${h.documentId}`,
    }));

    return { snippets };
  }
}
