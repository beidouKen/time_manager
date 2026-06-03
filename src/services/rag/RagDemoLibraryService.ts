// ============================================================
// RagDemoLibraryService.ts — V3.8.2 Local Coze-like RAG Demo Library
//
// 职责：
// - 提供 stats / 检索预览 / Coze-like 导出预览三种演示能力。
// - 全部委托 RagService，不直接读写 DB，不调用 Coze API。
//
// 定位：
// - 历史演示层：结构贴近 Coze Dataset，仅供管理 UI 调试。
// - V3.8.4 起正式 RAG 走 Self-hosted RAG Engine，不再优先 Coze。
//
// 安全边界：
// - 不调用 ToolRouter，不写 tasks / time_blocks。
// - retrieve / export 默认只处理 active 文档（export 显式 list status=active）。
// ============================================================

import { RagService } from "@/services/rag/RagService";
import type {
  CozeLikeDatasetPreview,
  LocalRagDataset,
  LocalRagDocumentView,
  LocalRagStats,
  RagSourceType,
  RetrievePreviewHit,
} from "@/types/rag.types";

export const DEFAULT_LOCAL_DATASET: LocalRagDataset = {
  id: "default_time_manager_context",
  name: "Time Manager 本地演示知识库",
  description:
    "用于本地调试 Agent 如何消费 RAG 资料；历史演示层。正式 RAG 见 V3.8.4 Self-hosted Engine。",
};

export interface CozeExportOptions {
  /** 默认 false：external_context 不进入导出预览。 */
  includeExternalContext?: boolean;
  /** 默认 true：user_material 进入导出预览。 */
  includeUserMaterial?: boolean;
}

export interface PreviewRetrieveOptions {
  sourceTypes?: RagSourceType[];
  limit?: number;
}

function emptyBySourceType(): Record<RagSourceType, number> {
  return {
    seed_knowledge: 0,
    external_context: 0,
    user_material: 0,
    memory_summary: 0,
    system_guidance: 0,
  };
}

export class RagDemoLibraryService {
  constructor(private readonly rag: RagService = new RagService()) {}

  getDataset(): LocalRagDataset {
    return DEFAULT_LOCAL_DATASET;
  }

  /** 统计当前知识库文档与 chunk 分布。 */
  async getStats(): Promise<LocalRagStats> {
    const docs = await this.rag.listDocuments();
    const bySourceType = emptyBySourceType();
    let activeCount = 0;
    let draftCount = 0;
    let archivedCount = 0;

    for (const d of docs) {
      bySourceType[d.sourceType] += 1;
      if (d.status === "active") activeCount += 1;
      else if (d.status === "draft") draftCount += 1;
      else if (d.status === "archived") archivedCount += 1;
    }

    const totalChunks = await this.rag.countChunks();

    return {
      totalDocuments: docs.length,
      activeCount,
      draftCount,
      archivedCount,
      totalChunks,
      bySourceType,
    };
  }

  /**
   * 本地检索预览：默认只返回 active 文档的命中（RagService.retrieve 默认行为）。
   */
  async previewRetrieve(
    query: string,
    opts: PreviewRetrieveOptions = {},
  ): Promise<RetrievePreviewHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const hits = await this.rag.retrieve(trimmed, {
      sourceTypes: opts.sourceTypes,
      limit: opts.limit ?? 5,
      // 默认 includeNonActive=false → 仅 active
    });

    const titleCache = new Map<string, string>();
    const results: RetrievePreviewHit[] = [];

    for (const h of hits) {
      let title = titleCache.get(h.documentId);
      if (title === undefined) {
        const doc = await this.rag.getDocument(h.documentId);
        title = doc?.title ?? "(未知文档)";
        titleCache.set(h.documentId, title);
      }
      results.push({
        documentId: h.documentId,
        title,
        sourceType: h.sourceType,
        content: h.content,
        score: h.score,
      });
    }

    return results;
  }

  /**
   * 构建 Coze-like Dataset 导出预览 JSON。
   * 仅包含符合导出策略的 active 文档；不调用 Coze API。
   */
  async buildCozeLikeDatasetPreview(
    opts: CozeExportOptions = {},
  ): Promise<CozeLikeDatasetPreview> {
    const includeExternal = opts.includeExternalContext === true;
    const includeUserMaterial = opts.includeUserMaterial !== false;

    const excludedReason: Record<string, string> = {
      system_guidance: "系统内部类型，不进入导出预览",
      memory_summary: "记忆摘要仅预留，不进入导出预览",
      draft: "draft 文档未启用，不导出",
      archived: "archived 文档已归档，不导出",
    };
    if (!includeExternal) {
      excludedReason.external_context =
        "external_context 默认不导出；需显式 includeExternalContext=true";
    }
    if (!includeUserMaterial) {
      excludedReason.user_material = "includeUserMaterial=false，已排除用户资料";
    }

    const activeDocs = await this.rag.listDocuments({ status: "active" });
    const includedSourceTypes: RagSourceType[] = ["seed_knowledge"];
    if (includeUserMaterial) includedSourceTypes.push("user_material");
    if (includeExternal) includedSourceTypes.push("external_context");

    const exportDocs: LocalRagDocumentView[] = [];

    for (const doc of activeDocs) {
      if (doc.sourceType === "system_guidance" || doc.sourceType === "memory_summary") {
        continue;
      }
      if (doc.sourceType === "external_context" && !includeExternal) {
        continue;
      }
      if (doc.sourceType === "user_material" && !includeUserMaterial) {
        continue;
      }
      if (doc.sourceType === "seed_knowledge") {
        // always include when active
      }

      const chunks = await this.rag.listChunksForDocument(doc.id);
      const content =
        chunks.length > 0
          ? chunks.map((c) => c.content).join("\n\n")
          : (doc.summary ?? doc.title).trim();

      exportDocs.push({
        title: doc.title,
        content,
        sourceType: doc.sourceType,
        tags: doc.tags,
        status: doc.status,
        trustLevel: doc.trustLevel,
      });
    }

    return {
      dataset: {
        name: DEFAULT_LOCAL_DATASET.name,
        description: DEFAULT_LOCAL_DATASET.description,
        documents: exportDocs,
      },
      meta: {
        generatedAt: new Date().toISOString(),
        documentCount: exportDocs.length,
        includedSourceTypes,
        excludedReason,
      },
    };
  }
}
