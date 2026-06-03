// ============================================================
// RagAdminActions.ts — V3.8.6+ 管理操作（委托 RagEngine）
// ============================================================

import type { RagEvalCase, RagEvalResult } from "@/services/rag/eval/RagEvalDataset";
import type { RagEngine, RagEngineHealth } from "@/services/rag/engine/RagEngine";
import type { RagIndexJob } from "@/services/rag/indexing/RagIndexJob";
import type { RagSourceType } from "@/types/rag.types";

export class RagAdminActions {
  constructor(private readonly engine: RagEngine) {}

  rebuildAllIndexes(
    opts?: { sourceTypes?: RagSourceType[] },
  ): Promise<RagIndexJob[]> {
    return this.engine.rebuildIndexes(opts);
  }

  rebuildKeywordIndex(): Promise<RagIndexJob> {
    return this.engine.rebuildKeywordIndex();
  }

  rebuildVectorIndex(
    opts?: { sourceTypes?: RagSourceType[] },
  ): Promise<RagIndexJob> {
    return this.engine.rebuildVectorIndex(opts);
  }

  runEvaluation(cases: RagEvalCase[]): Promise<RagEvalResult> {
    return this.engine.evaluate(cases);
  }

  runDefaultEvaluation(): Promise<RagEvalResult> {
    return this.engine.evaluateDefault();
  }

  healthCheck(): Promise<RagEngineHealth> {
    return this.engine.healthCheck();
  }
}
