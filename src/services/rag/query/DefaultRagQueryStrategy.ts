// ============================================================
// DefaultRagQueryStrategy.ts — V3.8.6 规则版查询构建（无 LLM）
// ============================================================

import type {
  RagQueryContext,
  RagQueryPlan,
  RagQueryStrategy,
} from "@/services/rag/query/RagQueryStrategy";

const MAX_QUERY_LEN = 256;

function dedupeAppend(parts: string[], seen: Set<string>): string[] {
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

export class DefaultRagQueryStrategy implements RagQueryStrategy {
  buildQuery(ctx: RagQueryContext): RagQueryPlan {
    const user = ctx.userInput?.trim() ?? "";
    if (!user && !(ctx.taskTitles?.length || ctx.blockTitles?.length)) {
      return { queryText: "", reason: "empty_input" };
    }

    const seen = new Set<string>();
    const segments: string[] = [];

    if (user) {
      seen.add(user.toLowerCase());
      segments.push(user);
    }

    const extras = dedupeAppend(
      [...(ctx.taskTitles ?? []), ...(ctx.blockTitles ?? [])],
      seen,
    );
    segments.push(...extras);

    let queryText = segments.join(" ").trim();
    if (queryText.length > MAX_QUERY_LEN) {
      queryText = queryText.slice(0, MAX_QUERY_LEN);
    }

    return {
      queryText,
      reason: user ? "user_input_with_context" : "context_titles_only",
    };
  }
}
