// ============================================================
// defaultRagEvalCases.ts — V3.8.7 固定评测集（对齐 seedRagKnowledge）
// ============================================================

import type { RagEvalCase } from "@/services/rag/eval/RagEvalDataset";

export const DEFAULT_RAG_EVAL_CASES: RagEvalCase[] = [
  {
    id: "pomodoro",
    query: "番茄工作法 专注 休息",
    expectedTitleContains: "番茄",
    expectedSourceType: "seed_knowledge",
    expectedTags: ["番茄钟"],
    topK: 5,
  },
  {
    id: "spaced-repetition",
    query: "间隔复习 遗忘曲线",
    expectedTitleContains: "艾宾浩斯",
    expectedSourceType: "seed_knowledge",
    expectedTags: ["间隔重复"],
    topK: 5,
  },
  {
    id: "deep-work",
    query: "深度工作 认知高峰 上午",
    expectedTitleContains: "精力",
    expectedSourceType: "seed_knowledge",
    expectedTags: ["深度工作"],
    topK: 5,
  },
  {
    id: "fragment-time",
    query: "碎片时间 两分钟 立即处理",
    expectedTitleContains: "两分钟",
    expectedSourceType: "seed_knowledge",
    topK: 5,
  },
  {
    id: "user-material",
    query: "用户课程资料 学习笔记",
    expectedSourceType: "user_material",
    topK: 5,
  },
];
