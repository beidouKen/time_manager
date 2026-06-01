// ============================================================
// ragKnowledgeStore.ts — V3.8.1 RAG Knowledge Manager 状态层
//
// 职责：
// - 暴露 RAG 资料治理给 SettingsPage / RagKnowledgeManagerDialog。
// - 维护 userMaterialInChatEnabled 全局开关（localStorage 持久化）。
// - 所有 CRUD 委托 RagIngestionService，不直接读写 DB。
//
// 安全边界：
// - 本 store 不会触发 ToolRouter / 不写 tasks / 不写 time_blocks。
// - userMaterialInChatEnabled 仅影响 SqliteRagAdapter.resolveSourceTypes，
//   再叠加 RagService.retrieve 的 status='active' 硬过滤，构成"双门控"。
// ============================================================

import { create } from "zustand";
import { RagIngestionService } from "@/services/rag/RagIngestionService";
import type {
  IngestDocumentInput,
  RagDocument,
  RagSourceType,
  RagStatus,
} from "@/types/rag.types";

const LS_KEY_USER_MATERIAL = "rag.userMaterialInChatEnabled";

function readUserMaterialFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LS_KEY_USER_MATERIAL) === "true";
  } catch {
    return false;
  }
}

function writeUserMaterialFlag(v: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY_USER_MATERIAL, v ? "true" : "false");
  } catch {
    // 静默：浏览器可能禁用 localStorage（隐私模式等），不影响主流程
  }
}

interface RagKnowledgeState {
  documents: RagDocument[];
  loading: boolean;
  error: string | null;
  /** 当前选中的文档 id；UI 用于切换右栏详情。 */
  selectedDocumentId: string | null;
  /**
   * 全局开关：是否允许 user_material 进入 Chat 主路径检索。
   * 双门控的第 1 道，第 2 道是文档的 status='active'。
   */
  userMaterialInChatEnabled: boolean;
}

interface RagKnowledgeActions {
  loadDocuments: (opts?: {
    sourceType?: RagSourceType;
    status?: RagStatus;
    search?: string;
    limit?: number;
  }) => Promise<void>;

  createDraft: (input: IngestDocumentInput) => Promise<RagDocument | null>;
  activate: (id: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
  softDelete: (id: string) => Promise<void>;
  updateMeta: (
    id: string,
    patch: Partial<{
      title: string;
      summary: string | null;
      sourceRef: string | null;
      tags: string[];
    }>,
  ) => Promise<void>;

  selectDocument: (id: string | null) => void;
  setUserMaterialInChat: (v: boolean) => void;
}

// 单例 Ingestion 服务；不在 store 构造时实例化以保持轻量
let ingestionService: RagIngestionService | null = null;
function getIngestion(): RagIngestionService {
  if (!ingestionService) ingestionService = new RagIngestionService();
  return ingestionService;
}

/** 仅测试使用：注入自定义 service，便于断言不写库。 */
export function __setRagIngestionServiceForTest(svc: RagIngestionService | null): void {
  ingestionService = svc;
}

export const useRagKnowledgeStore = create<RagKnowledgeState & RagKnowledgeActions>(
  (set, get) => ({
    documents: [],
    loading: false,
    error: null,
    selectedDocumentId: null,
    userMaterialInChatEnabled: readUserMaterialFlag(),

    loadDocuments: async (opts) => {
      set({ loading: true, error: null });
      try {
        const docs = await getIngestion().listDocuments(opts ?? {});
        set({ documents: docs, loading: false });
      } catch (e) {
        set({ loading: false, error: String(e) });
      }
    },

    createDraft: async (input) => {
      set({ error: null });
      try {
        const doc = await getIngestion().createDraftDocument(input);
        // 把新文档插到列表前面，UI 立刻能看到
        set((s) => ({
          documents: [doc, ...s.documents],
          selectedDocumentId: doc.id,
        }));
        return doc;
      } catch (e) {
        set({ error: String(e) });
        return null;
      }
    },

    activate: async (id) => {
      try {
        await getIngestion().activateDocument(id);
        // 重新拉一次列表，保证 reviewed_at / updated_at 等字段刷新
        await get().loadDocuments();
      } catch (e) {
        set({ error: String(e) });
      }
    },

    archive: async (id) => {
      try {
        await getIngestion().archiveDocument(id);
        await get().loadDocuments();
      } catch (e) {
        set({ error: String(e) });
      }
    },

    softDelete: async (id) => {
      try {
        await getIngestion().softDeleteDocument(id);
        set((s) => ({
          documents: s.documents.filter((d) => d.id !== id),
          selectedDocumentId:
            s.selectedDocumentId === id ? null : s.selectedDocumentId,
        }));
      } catch (e) {
        set({ error: String(e) });
      }
    },

    updateMeta: async (id, patch) => {
      try {
        await getIngestion().updateDocumentMeta(id, patch);
        await get().loadDocuments();
      } catch (e) {
        set({ error: String(e) });
      }
    },

    selectDocument: (id) => set({ selectedDocumentId: id }),

    setUserMaterialInChat: (v) => {
      writeUserMaterialFlag(v);
      set({ userMaterialInChatEnabled: v });
    },
  }),
);
