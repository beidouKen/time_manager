// ============================================================
// MemoryToRagBridge.ts — V3.8.7 Memory → RAG 预留桥（不接入 App/Chat）
//
// 禁止 import ToolRouter / TaskService / TimeBlockService / ScheduleService
// ============================================================

import type { RagIngestionService } from "@/services/rag/RagIngestionService";
import type { RagDocument } from "@/types/rag.types";

export interface MemorySummaryDraft {
  title: string;
  summary: string;
  fullText: string;
  tags?: string[];
}

export interface MemoryToRagInput {
  recentMessages: string[];
  selectedDate?: string;
}

export interface MemorySummaryValidation {
  ok: boolean;
  reason?: string;
}

const UI_WRITE_ERROR =
  "policy rejected: memory_summary ui-write not allowed";

export class MemoryToRagBridge {
  constructor(private readonly ingestion: RagIngestionService) {}

  /** 纯规则拼接，不调 LLM */
  proposeMemorySummary(input: MemoryToRagInput): MemorySummaryDraft {
    const lines = (input.recentMessages ?? [])
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(-10);
    const body = lines.join("\n").slice(0, 2000);
    const datePart = input.selectedDate ? ` (${input.selectedDate})` : "";
    const title = `Memory Summary${datePart}`.slice(0, 120);
    const summary = body.slice(0, 280) || "（无近期消息）";
    return {
      title,
      summary,
      fullText: body || summary,
      tags: ["memory_summary"],
    };
  }

  validateMemorySummaryDraft(draft: MemorySummaryDraft): MemorySummaryValidation {
    if (!draft.title?.trim()) {
      return { ok: false, reason: "title is required" };
    }
    if (!draft.summary?.trim()) {
      return { ok: false, reason: "summary is required" };
    }
    if (!draft.fullText?.trim()) {
      return { ok: false, reason: "fullText is required" };
    }
    if (draft.fullText.length > 8000) {
      return { ok: false, reason: "fullText too long" };
    }
    return { ok: true };
  }

  async ingestMemorySummary(
    draft: MemorySummaryDraft,
    actor: "ui" | "system" = "system",
  ): Promise<RagDocument> {
    if (actor === "ui") {
      throw new Error(UI_WRITE_ERROR);
    }
    const validation = this.validateMemorySummaryDraft(draft);
    if (!validation.ok) {
      throw new Error(`[MemoryToRagBridge] invalid draft: ${validation.reason}`);
    }
    return this.ingestion.createDraftDocument(
      {
        sourceType: "memory_summary",
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        fullText: draft.fullText.trim(),
        tags: draft.tags ?? ["memory_summary"],
        status: "draft",
      },
      "system",
    );
  }
}
