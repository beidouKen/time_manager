// ============================================================
// contextBuilder.ts — 轻量上下文类型导出
//
// C6 §G15: ContextBuilder 类已物理删除（零生产引用，C4 已迁移到 ContextAssembler）。
// RecentMessage / LLMContext 类型仍被 AgentService / LLMExperiencePlanner /
// ConversationContextBuilder 引用，保留导出以维持编译稳定。
// ============================================================

export interface RecentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMContext {
  recentMessages: Array<{ role: string; content: string }>;
  todayTasks: Array<{
    id: string;
    title: string;
    status: string;
    priority?: string;
  }>;
  todayBlocks: Array<{
    id: string;
    title: string;
    start_time: string;
    end_time: string;
    status: string;
  }>;
  lastTaskId: string | null;
  lastTimeBlockId: string | null;
  currentDate: string;
}
