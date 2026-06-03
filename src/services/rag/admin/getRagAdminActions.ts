// ============================================================
// getRagAdminActions.ts — V3.8.7 Admin 单例装配
// ============================================================

import { RagAdminActions } from "@/services/rag/admin/RagAdminActions";
import { createDefaultRagEngine } from "@/services/rag/engine/RagEngineFactory";

let cached: RagAdminActions | undefined;
let tried = false;

export function getRagAdminActions(): RagAdminActions | undefined {
  if (tried) return cached;
  tried = true;
  try {
    const engine = createDefaultRagEngine();
    if (!engine) return undefined;
    cached = new RagAdminActions(engine);
    return cached;
  } catch (e) {
    console.warn("[getRagAdminActions] failed:", e);
    return undefined;
  }
}

export function resetRagAdminActionsForTests(): void {
  cached = undefined;
  tried = false;
}
