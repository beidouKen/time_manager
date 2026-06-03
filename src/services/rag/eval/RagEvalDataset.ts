// ============================================================
// RagEvalDataset.ts — V3.8.7 RAG 评测用例类型
// ============================================================

import type { RagSourceType } from "@/types/rag.types";

export interface RagEvalCase {
  id: string;
  query: string;
  expectedSourceType?: RagSourceType;
  expectedTags?: string[];
  expectedTitleContains?: string;
  /** 兼容旧字段：精确标题匹配 */
  expectedDocumentTitle?: string;
  topK?: number;
}

export type RagEvalMatchKind =
  | "title"
  | "sourceType"
  | "tags"
  | "titleContains";

export interface RagEvalCaseResult {
  id: string;
  query: string;
  matched: boolean;
  topHitTitle?: string;
  topScore?: number;
  matchedBy?: RagEvalMatchKind;
}

export interface RagEvalResult {
  totalCases: number;
  matchedCount: number;
  hitAtK: number;
  sourceTypeMatchRate: number;
  titleMatchRate: number;
  averageTopScore: number;
  perCase: RagEvalCaseResult[];
}
