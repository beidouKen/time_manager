// ============================================================
// RagQueryStrategy.ts — V3.8.6 查询策略接口
// ============================================================

import type { RagSourceType } from "@/types/rag.types";

export interface RagQueryContext {
  userInput: string;
  recentMessages?: string[];
  currentScreen?: string;
  taskTitles?: string[];
  blockTitles?: string[];
  selectedDate?: string;
  timezone?: string;
}

export interface RagQueryPlan {
  queryText: string;
  preferredSourceTypes?: RagSourceType[];
  preferredTags?: string[];
  reason: string;
}

export interface RagQueryStrategy {
  buildQuery(ctx: RagQueryContext): RagQueryPlan;
}
