// ============================================================
// seedRagKnowledge.ts — V3.8 RAG 时间管理理论种子知识
//
// 在 App 启动 runMigrations() 之后调用，写入 5 条经典时间管理理论。
// 严格幂等：按 (sourceType, title) 查重，已存在则跳过本条。
//
// 这些 seed 文档让 RecommendationHandler 第一次能从真实 RAG 库检索到
// 内容，从而让用户在 Chat 中看到非 mock 的建议。
//
// 修改/扩充种子时请保持：
// - sourceType 固定为 "seed_knowledge"。
// - 标签使用中文短语，方便 keyword + tag 联合检索。
// - 单条 content 控制在数百字内，无需切块。
// ============================================================

import type { RagService } from "@/services/rag/RagService";
import type { IngestDocumentInput } from "@/types/rag.types";

interface SeedEntry extends Omit<IngestDocumentInput, "sourceType"> {
  title: string;
  summary: string;
  tags: string[];
  fullText: string;
}

const SEED_KNOWLEDGE: SeedEntry[] = [
  {
    title: "番茄工作法",
    summary: "25 分钟专注 + 5 分钟休息为一组，4 组后长休 15-30 分钟。",
    tags: ["专注", "休息", "效率", "番茄钟"],
    fullText:
      "番茄工作法的核心是把工作切分为固定长度的专注单元。" +
      "标准配置：25 分钟专注 + 5 分钟休息为一个番茄钟；连续完成 4 个番茄钟后安排一次 15-30 分钟的长休息。" +
      "适合需要持续注意力的认知任务，例如写作、阅读、编码。" +
      "排期建议：避免把单个任务块设置超过 50 分钟（两个番茄钟）不留休息；" +
      "高强度脑力任务连续时长上限建议为 90 分钟。",
  },
  {
    title: "艾宾浩斯遗忘曲线",
    summary: "学习后遗忘速度先快后慢，按 1/3/7/14/30 天复习可有效巩固记忆。",
    tags: ["复习", "记忆", "间隔重复", "学习"],
    fullText:
      "艾宾浩斯遗忘曲线说明：学习后 20 分钟即开始遗忘，1 天后留存约 33%，6 天后约 25%。" +
      "对抗遗忘的有效策略是间隔重复（Spaced Repetition）。" +
      "推荐复习节点：学习当天、第 1 天、第 3 天、第 7 天、第 14 天、第 30 天。" +
      "排期建议：为学习类任务自动安排间隔复习时间块，每次 10-20 分钟即可，" +
      "避免在临考前才集中长时间复习。",
  },
  {
    title: "精力曲线与时段分配",
    summary: "上午 9-11 点为认知高峰，下午 3-5 点次高峰，应据此安排深度工作。",
    tags: ["时段", "效率", "深度工作", "精力管理"],
    fullText:
      "多数人的认知能力存在自然波动：上午 9-11 点常为高峰，午后 13-15 点为低谷（餐后困倦），" +
      "下午 15-17 点回升为次高峰，晚间逐步下降。" +
      "排期建议：把需要深度思考的任务（写作、编程、学习）放在上午高峰；" +
      "把机械性、低认知负荷的任务（整理、回复、归档）放在午后低谷；" +
      "避免在 22 点后安排需要决策的任务，决策疲劳会显著降低质量。",
  },
  {
    title: "GTD 两分钟原则",
    summary: "若一件事 2 分钟内能完成，立即处理，不纳入待办列表。",
    tags: ["GTD", "任务管理", "决策", "两分钟原则"],
    fullText:
      "Getting Things Done（GTD）的两分钟原则：当面对一件新任务时，" +
      "若评估能在 2 分钟内完成，则立即处理；超过 2 分钟才进入待办或日程系统。" +
      "理由：登记、归类、排期、再回顾这一系列动作本身就耗费数分钟，" +
      "对极短任务来说成本超过收益。" +
      "排期建议：日常出现的小事（短回复、确认、归档）若可立即解决就直接做掉；" +
      "Inbox 里只保留真正需要规划的事项，避免任务列表被琐事淹没。",
  },
  {
    title: "上下文切换成本",
    summary: "每次任务切换需 15-23 分钟重新进入状态，建议同类任务聚合排期。",
    tags: ["专注", "任务切换", "碎片时间", "深度工作"],
    fullText:
      "认知科学研究表明：从一个任务切换到另一个任务后，大脑需要 15-23 分钟" +
      "才能完全进入新任务的工作状态。频繁切换会显著降低单位时间产出。" +
      "排期建议：把同类任务聚合到一起排期（例如所有沟通类任务集中在某个时段）；" +
      "为深度工作预留至少 60-90 分钟的不可打断时段；" +
      "碎片时间（10-15 分钟）适合做不需要进入状态的任务，例如阅读邮件、整理笔记、复习卡片，" +
      "不适合开始一个全新的复杂任务。",
  },
];

/**
 * 幂等写入 seed 文档。
 * 若任意一条已存在则跳过该条；不会重复创建。
 */
export async function seedRagKnowledge(service: RagService): Promise<void> {
  for (const entry of SEED_KNOWLEDGE) {
    const existing = await service.findDocumentByTitle(
      "seed_knowledge",
      entry.title,
    );
    if (existing) continue;

    await service.ingestDocument({
      sourceType: "seed_knowledge",
      title: entry.title,
      summary: entry.summary,
      tags: entry.tags,
      fullText: entry.fullText,
      metadata: { origin: "builtin_seed", version: "v3.8.1" },
      // V3.8.1：内置 seed 默认 active + high，无需手动 review。
      status: "active",
      trustLevel: "high",
    });
  }
}

/** 导出种子定义，便于测试和文档化。 */
export const __SEED_KNOWLEDGE_FOR_TEST = SEED_KNOWLEDGE;
