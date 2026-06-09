// ============================================================
// MemoryRecordTool — Memory 写入能力预留实现（占位骨架）
//
// 目标定位：
// - 这是后续 "Agent 主动沉淀用户偏好/反馈/执行结果" 的工具入口。
// - 与 memory_retrieve 配对，构成 Memory 的显式读/写能力边界。
//
// 当前状态：
// - 不默认注册到生产 ToolRouter。
// - 不加入 LLM prompt 工具白名单（src/agent/llm/prompts.ts）。
// - execute() 当前**永远返回 recorded=false**：即使被误注册到 ToolRouter，
//   也不会真正写入任何长期状态。
//
// 为什么不立刻接入真实写入：
// - Memory 写入涉及长期状态，必须先建立明确策略：
//   1. 去重：避免 LLM 反复写相同事实。
//   2. 置信度：低置信度声明不应直接固化。
//   3. 用户可见性：写入哪些内容应对用户透明。
//   4. 可选 confirmation：偏好类长期写入可能需要用户确认。
// - 上述策略未落地前，让 LLM "随手" 写 Memory 风险高于收益。
//
// 后续工具化路线（不在本阶段范围）：
// 1. 设计 MemoryWritePolicy（去重 / 置信度 / 可见性 / 是否需要 confirmation）。
// 2. 扩展 MemoryAdapter，新增 recordEvent(eventType, content, metadata) 接口。
// 3. 在 PlanSafetyValidator / ConfirmationPolicy 中纳入 memory_record。
// 4. 注册 MemoryRecordTool 到 ToolRouter，并把 requiresConfirmation 改为
//    根据 eventType 动态决定（例如 user_preference 必须 confirm）。
// 5. 将 memory_record 加入 prompts.ts 工具白名单。
//
// 安全约束（即使未来注册，也必须遵守）：
// - 不调用 LLM，不调用其他 Tool。
// - 不读取 / 写入 Task / TimeBlock Service。
// - 永远不要在没有 policy 校验的情况下静默写入长期状态。
//
// 详见 docs/V3.8/RAG_AND_MEMORY_TOOLIZATION_NOTES.md。
// ============================================================

import type { MemoryAdapter } from "@/agent/memory/MemoryAdapter";
import { BaseTool } from "@/agent/tools/BaseTool";
import type { ToolResult } from "@/agent/types";

/**
 * memory_record 工具事件类型。
 */
export type MemoryRecordEventType =
  | "user_preference"
  | "task_completed"
  | "schedule_feedback"
  | "behavior_observation";

/**
 * memory_record 工具参数契约。
 */
export interface MemoryRecordArgs {
  eventType: MemoryRecordEventType;
  /** 事件内容（自然语言摘要），必填。 */
  content: string;
  /** 附加结构化元数据；未来用于去重 / 置信度判定。 */
  metadata?: Record<string, unknown>;
}

/**
 * memory_record 工具返回结构。
 *
 * 当前阶段 `recorded` 永远为 false：未启用真实写入。
 */
export interface MemoryRecordResult {
  recorded: boolean;
}

const ALLOWED_EVENT_TYPES: ReadonlySet<MemoryRecordEventType> = new Set([
  "user_preference",
  "task_completed",
  "schedule_feedback",
  "behavior_observation",
]);

export class MemoryRecordTool extends BaseTool {
  name = "memory_record";
  description =
    "记录用户反馈、任务完成情况、偏好声明、执行结果到长期记忆（写入，未来需经过策略层）";
  /**
   * stub 阶段不写入，故 requiresConfirmation=false。
   * 真实实现时应按 eventType 动态判定：
   * - user_preference / schedule_feedback → 通常需要 confirmation。
   * - task_completed / behavior_observation → 可由系统侧静默记录。
   */
  requiresConfirmation = false;
  /**
   * 即使是 stub 也标注 medium，提示未来 PlanSafetyValidator / ConfirmationPolicy
   * 需要把 memory_record 纳入风险评估。
   */
  riskLevel = "medium" as const;

  // 接受 adapter 仅为未来构造对齐，当前 execute 不调用它。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_memoryAdapter?: MemoryAdapter) {
    super();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const rawEventType = this.requireParam<string>(args, "eventType", "事件类型");
    if (!ALLOWED_EVENT_TYPES.has(rawEventType as MemoryRecordEventType)) {
      return this.failure(
        `不支持的 memory eventType=${rawEventType}（允许：${Array.from(ALLOWED_EVENT_TYPES).join(", ")}）`,
      );
    }

    // content / metadata 仅做契约校验，不真正使用
    const content = this.requireParam<string>(args, "content", "事件内容").trim();
    if (!content) {
      return this.failure("memory_record content 不能为空");
    }
    // metadata 可选，无需校验
    void args.metadata;

    // 关键：stub 阶段永远不真正写入。
    return this.success(
      "memory_record 当前为占位骨架，未写入长期状态（等待 MemoryWritePolicy 与 adapter.recordEvent 落地）",
      { recorded: false } satisfies MemoryRecordResult,
    );
  }
}
