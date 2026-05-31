# Mock 验证路径使用指南

**版本**：Phase 1 — 统一 Mock 验证路径  
**日期**：2026-05-30  

---

## 一、目录结构

```
src/agent/
├── testing/                          # 测试专用，不在生产代码中 import
│   ├── memoryServices.ts             # 进程内 Service/Repository 实现（五件套）
│   ├── createMockAgentHarness.ts     # 统一 AgentService mock 装配器
│   ├── mockInput.ts                  # 断言工具函数
│   ├── StubPlanner.ts                # 防御性测试 PlannerPort 实现
│   └── __tests__/
│       └── mock_smoke.test.ts        # 5 条 Phase 1 Smoke Tests
├── memory/
│   ├── MemoryAdapter.ts              # 行为记录接口
│   ├── MockMemoryAdapter.ts          # 进程内实现（附 dump/clear）
│   ├── RagAdapter.ts                 # RAG 检索接口
│   └── MockRagAdapter.ts             # 固定摘要实现（附 setSnippets）
├── notification/
│   ├── NotificationAdapter.ts        # 通知发送接口
│   └── MockNotificationAdapter.ts    # 进程内实现（附 drain/peek/clear）
└── experience/
    └── PlannerPort.ts                # Planner 抽象接口（ActionPlanner 实现）
```

---

## 二、快速开始

### 2.1 创建标准 mock 环境

```typescript
import { createMockAgentHarness } from "@/agent/testing/createMockAgentHarness";

const { agent, tasks, blocks, confirmRepo, logs, memory, rag, notifier } =
  createMockAgentHarness();
```

**返回对象说明**：

| 字段 | 类型 | 用途 |
|---|---|---|
| `agent` | `AgentService` | 被测 Agent 实例 |
| `tasks` | `MemoryTaskService` | 断言 task 写入：`tasks.tasks` |
| `blocks` | `MemoryTimeBlockService` | 断言 block 写入：`blocks.blocks` |
| `confirmRepo` | `MemoryConfirmationRepository` | 断言 confirmation 状态：`confirmRepo.records` |
| `logs` | `MemoryActionLogPort` | 断言 action log 链路：`logs.entries` |
| `memory` | `MockMemoryAdapter` | 断言行为记录：`memory.dump()` |
| `rag` | `MockRagAdapter` | 控制 RAG 返回：`rag.setSnippets([...])` |
| `notifier` | `MockNotificationAdapter` | 断言通知事件：`notifier.drain()` |

### 2.2 注入 StubPlanner（防御性测试）

```typescript
import { StubPlanner } from "@/agent/testing/StubPlanner";
import { createMockAgentHarness } from "@/agent/testing/createMockAgentHarness";

const stub = new StubPlanner({
  kind: "tool",
  toolName: "nonexistent_tool",  // 未注册的工具名，测试防御层
  requiresConfirmation: false,
});

const { agent, tasks, blocks } = createMockAgentHarness({ plannerPort: stub });
const response = await agent.processInput("任意输入");
// 断言：AgentService 应拒绝执行，走 boundary fallback
expect(tasks.tasks).toHaveLength(0);
```

### 2.3 使用断言工具

```typescript
import {
  expectNoInternalNames,
  expectConfirmationRequired,
  expectRefreshHints,
  expectMessageContainsOneOf,
} from "@/agent/testing/mockInput";

// 断言消息不泄漏内部名称
expectNoInternalNames(response.message);

// 断言操作进入确认链路（未写库）
expectConfirmationRequired(response, tasks.tasks.length, blocks.blocks.length);

// 断言 refreshHints 包含预期字段
expectRefreshHints(response.refreshHints, { tasks: true, timeline: true });

// 断言消息含关键词之一
expectMessageContainsOneOf(response.message, ["安排", "创建", "已为你"]);
```

---

## 三、如何写一条新 mock case

### 步骤

1. 在合适的测试文件（`agent_v3_*.test.ts` 等）中 import `createMockAgentHarness`
2. 使用 `vi.useFakeTimers()` + `vi.setSystemTime(new Date("..."))` 固定时间
3. 调用 `agent.processInput("用户输入")`
4. 使用 `tasks.tasks`、`blocks.blocks`、`confirmRepo.records` 断言状态变化
5. 使用 `expectNoInternalNames()` 断言 boundary 正确工作
6. 如测试高风险操作，使用 `agent.confirmAction()` / `agent.rejectAction()` 完整链路

### 模板

```typescript
it("describe: your scenario", async () => {
  const { agent, tasks, blocks, confirmRepo } = createMockAgentHarness();

  const response = await agent.processInput("你的输入");

  // 断言 domain 路由正确（通过行为而非直接读取 domain）
  expect(tasks.tasks).toHaveLength(N);
  expect(blocks.blocks).toHaveLength(N);

  // 断言消息质量
  expectNoInternalNames(response.message);
  expect(response.message.length).toBeGreaterThan(0);
});
```

---

## 四、Mock 适配器注意事项

### MemoryAdapter（行为记录）
- Phase 1 骨架建立，V5 阶段填入语义。
- `recordSchedule()` 应在 ToolRouter execute `schedule_task` **成功后**调用，不在 Tool 内部调用。
- `dump()` 返回所有原始记录，供断言。

### RagAdapter（RAG 检索）
- `MockRagAdapter` 默认返回固定 2 条摘要（写作超时模式 + 时间偏好模式）。
- 可用 `rag.setSnippets([])` 覆盖为空，测试 Agent 在无 RAG 数据时的行为。

### NotificationAdapter（通知）
- `MockNotificationAdapter` 只收集事件，不发送真实通知。
- `notifier.drain()` 返回并清空队列，适合每个 it 独立断言。
- V5 阶段：只有 `create_time_block`（type=event）链路应触发通知，建议类响应不触发。

### PlannerPort / StubPlanner
- `ActionPlanner` 是唯一生产实现，不要修改其行为逻辑。
- `StubPlanner` 仅用于防御性测试（测试 AgentService 是否正确拦截非法 plan）。
- 禁止在 `createMockAgentHarness` 默认调用中使用 `StubPlanner`。

---

## 五、禁止行为

- 不在测试中调用真实 `DeepSeekClient`。
- 不在测试中访问真实 SQLite / 文件系统。
- 不写断言为空的 test（`it("...", () => {})`）。
- 不为了让测试通过而在实现中写死判断（如 `if (input === "xxx") return "硬编码"`）。
- `StubPlanner` 禁止出现在 `src/agent/` 任何生产代码 import 中。

---

*生成于 Phase 1 Mock 验证路径搭建，2026-05-30*
