// ============================================================
// RagIngestionService.ts — V3.8.1 RAG 资料治理服务
//
// 职责：
// - 在开发者 UI 与底层 RagService 之间承担 Policy 与生命周期编排。
// - createDraftDocument / activateDocument / archiveDocument / softDeleteDocument。
// - validateSourceTypePolicy 集中处理"哪些 sourceType 允许通过 UI 创建/激活"。
//
// 安全边界（不可变）：
// - 不调用 ToolRouter，不写 tasks / time_blocks。
// - 不直接读写 DB，所有持久化委托给 RagService。
// - external_context 经 UI 写入时强制 status='draft'，不能短路到 active。
// - system_guidance / memory_summary 仅允许 actor='system' 创建/激活，
//   UI 路径直接拒绝。
//
// 设计原则：
// - RagService 保持薄 CRUD + retrieve，本服务承载策略；测试可以分别覆盖。
// - 不引入 owner_id / workspace_id 等多用户字段（本轮不在 scope）。
// ============================================================

import { RagService } from "@/services/rag/RagService";
import type {
  IngestDocumentInput,
  RagDocument,
  RagSourceType,
  RagStatus,
} from "@/types/rag.types";

/** Policy 调用方：UI 路径默认 'ui'，未来 Memory→RAG 自动写入会传 'system'。 */
export type RagPolicyActor = "ui" | "system";

/** Policy 涉及的动作。 */
export type RagPolicyAction = "create" | "activate";

export interface RagPolicyResult {
  ok: boolean;
  /** ok=false 时给出原因，供调用方展示给用户。 */
  reason?: string;
  /** create 动作时，Policy 可能强制覆写 status（例如 external_context → draft）。 */
  forcedStatus?: RagStatus;
}

/**
 * V3.8.1：集中校验 sourceType 在指定动作下是否允许。
 *
 * Policy 规则：
 * - system_guidance：actor='ui' 全部拒绝；只允许 'system' 调用方。
 * - memory_summary：actor='ui' 全部拒绝；留给未来 Memory 系统写入。
 * - external_context：UI 创建允许，但 forcedStatus='draft'，忽略入参 status。
 * - 其余 (seed_knowledge / user_material)：UI 创建允许，activate 也允许；
 *   后续真正多用户场景再做差异化。
 */
export function validateSourceTypePolicy(
  sourceType: RagSourceType,
  action: RagPolicyAction,
  actor: RagPolicyActor = "ui",
): RagPolicyResult {
  if (sourceType === "system_guidance" && actor !== "system") {
    return {
      ok: false,
      reason: "system_guidance 类型不允许通过 UI 写入或激活，仅系统内部可使用。",
    };
  }
  if (sourceType === "memory_summary" && actor !== "system") {
    return {
      ok: false,
      reason: "memory_summary 类型不允许通过 UI 写入或激活，留给未来 Memory 系统生成。",
    };
  }
  if (sourceType === "external_context" && action === "create") {
    return { ok: true, forcedStatus: "draft" };
  }
  return { ok: true };
}

export class RagIngestionService {
  constructor(private readonly rag: RagService = new RagService()) {}

  /**
   * 创建一篇文档；UI 路径强制 status='draft'，需要管理员显式激活。
   *
   * - external_context：Policy 已强制 forcedStatus='draft'。
   * - system_guidance：UI 路径直接拒绝。
   * - 其他 sourceType：默认 draft，可在前端创建后手动调用 activate。
   */
  async createDraftDocument(
    input: IngestDocumentInput,
    actor: RagPolicyActor = "ui",
  ): Promise<RagDocument> {
    const policy = validateSourceTypePolicy(input.sourceType, "create", actor);
    if (!policy.ok) {
      throw new Error(`[RagIngestionService] ${policy.reason ?? "policy rejected"}`);
    }
    const finalStatus: RagStatus = policy.forcedStatus ?? "draft";
    return this.rag.ingestDocument({
      ...input,
      status: finalStatus,
    });
  }

  /**
   * 把文档置为 active；UI 路径下不允许激活 system_guidance。
   */
  async activateDocument(id: string, actor: RagPolicyActor = "ui"): Promise<void> {
    const doc = await this.rag.getDocument(id);
    if (!doc) throw new Error(`[RagIngestionService] document not found: ${id}`);
    const policy = validateSourceTypePolicy(doc.sourceType, "activate", actor);
    if (!policy.ok) {
      throw new Error(`[RagIngestionService] ${policy.reason ?? "policy rejected"}`);
    }
    await this.rag.activateDocument(id);
  }

  async archiveDocument(id: string): Promise<void> {
    const doc = await this.rag.getDocument(id);
    if (!doc) throw new Error(`[RagIngestionService] document not found: ${id}`);
    await this.rag.archiveDocument(id);
  }

  /**
   * 软删除（写 deleted_at），保留追溯。
   */
  async softDeleteDocument(id: string): Promise<void> {
    await this.rag.deleteDocument(id);
  }

  /**
   * 管理 UI 列表入口；与 Chat 主路径 retrieve 不同，本方法可以包含所有 status。
   */
  async listDocuments(opts: {
    sourceType?: RagSourceType;
    status?: RagStatus;
    search?: string;
    limit?: number;
  } = {}): Promise<RagDocument[]> {
    return this.rag.listDocuments({
      sourceType: opts.sourceType,
      status: opts.status,
      search: opts.search,
      limit: opts.limit,
    });
  }

  async getDocument(id: string): Promise<RagDocument | null> {
    return this.rag.getDocument(id);
  }

  /**
   * 暴露元数据 patch；不允许通过此入口改 sourceType / status。
   * 状态变更必须通过 activate / archive / softDelete 显式调用。
   */
  async updateDocumentMeta(
    id: string,
    patch: Parameters<RagService["updateDocument"]>[1],
  ): Promise<void> {
    await this.rag.updateDocument(id, patch);
  }
}
