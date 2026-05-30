// ============================================================
// createMockAgentHarness.ts — 统一 mock AgentService 装配器
//
// 提供完整的进程内 mock 环境，用于所有 agent 测试。
// 返回值包含所有可供测试断言的 mock 对象。
//
// 使用示例：
//   const { agent, tasks, blocks, confirmRepo, logs, memory, rag, notifier } =
//     createMockAgentHarness();
//   await agent.processInput("我现在有一个写文档任务，10分钟，从现在开始");
//   expect(tasks.tasks).toHaveLength(1);
//   expect(blocks.blocks).toHaveLength(1);
// ============================================================

import { AgentService } from "@/agent/AgentService";
import { ConfirmationService } from "@/services/ConfirmationService";
import type { PlannerPort } from "@/agent/experience/PlannerPort";
import type { MemoryAdapter } from "@/agent/memory/MemoryAdapter";
import type { RagAdapter } from "@/agent/memory/RagAdapter";
import type { NotificationAdapter } from "@/agent/notification/NotificationAdapter";
import type { LLMClient } from "@/agent/llm/LLMClient";
import { MockMemoryAdapter } from "@/agent/memory/MockMemoryAdapter";
import { MockRagAdapter } from "@/agent/memory/MockRagAdapter";
import { MockNotificationAdapter } from "@/agent/notification/MockNotificationAdapter";
import {
  MemoryTaskService,
  MemoryTimeBlockService,
  MemoryScheduleService,
  MemoryConfirmationRepository,
  MemoryActionLogPort,
} from "@/agent/testing/memoryServices";

export interface MockAgentHarness {
  agent: AgentService;
  tasks: MemoryTaskService;
  blocks: MemoryTimeBlockService;
  confirmRepo: MemoryConfirmationRepository;
  logs: MemoryActionLogPort;
  memory: MockMemoryAdapter;
  rag: MockRagAdapter;
  notifier: MockNotificationAdapter;
}

export interface MockAgentHarnessOptions {
  /** 注入自定义 PlannerPort（默认使用 ActionPlanner 规则路径）。用于 StubPlanner 防御测试。 */
  plannerPort?: PlannerPort;
  /**
   * V3.7: 注入 LLM 客户端。
   * - 不传（undefined）：默认禁用 LLM（null），走规则路径，避免测试依赖真实 API。
   * - 传 MockLLMClient：测试 LLM 路径。
   */
  llmClient?: LLMClient;
  /** 覆盖 MemoryAdapter（默认 MockMemoryAdapter）。 */
  memoryAdapter?: MemoryAdapter;
  /** 覆盖 RagAdapter（默认 MockRagAdapter）。 */
  ragAdapter?: RagAdapter;
  /** 覆盖 NotificationAdapter（默认 MockNotificationAdapter）。 */
  notificationAdapter?: NotificationAdapter;
}

/**
 * 创建完整的 mock agent 测试环境。
 * 所有 service/repo 均为进程内实现，不依赖真实数据库、LLM、外部 API。
 */
export function createMockAgentHarness(
  options: MockAgentHarnessOptions = {}
): MockAgentHarness {
  const tasks = new MemoryTaskService();
  const blocks = new MemoryTimeBlockService();
  const schedule = new MemoryScheduleService(tasks, blocks);
  const confirmRepo = new MemoryConfirmationRepository();
  const confirmService = new ConfirmationService(confirmRepo);
  const logs = new MemoryActionLogPort();

  const memory = (options.memoryAdapter as MockMemoryAdapter | undefined) ?? new MockMemoryAdapter();
  const rag = (options.ragAdapter as MockRagAdapter | undefined) ?? new MockRagAdapter();
  const notifier = (options.notificationAdapter as MockNotificationAdapter | undefined) ?? new MockNotificationAdapter();

  const agent = new AgentService({
    taskService: tasks,
    timeBlockService: blocks,
    scheduleService: schedule,
    logService: logs,
    confirmService,
    plannerPort: options.plannerPort,
    // V3.7: 默认禁用 LLM（null），避免测试依赖真实 API。
    // 若需要测试 LLM 路径，显式传入 MockLLMClient。
    llmClient: options.llmClient ?? null,
    memoryAdapter: memory,
    ragAdapter: rag,
    notificationAdapter: notifier,
  });

  return { agent, tasks, blocks, confirmRepo, logs, memory, rag, notifier };
}

/**
 * 便捷构造：创建带 LLM client 的 mock harness（用于 LLM 安全边界测试）。
 */
export function createMockAgentHarnessWithLLM(
  llmClient: LLMClient,
  options: Omit<MockAgentHarnessOptions, "llmClient"> = {}
): MockAgentHarness {
  return createMockAgentHarness({ ...options, llmClient });
}
