# Agent V3 → V5 全链路回归最终报告

**日期**：2026-05-30  
**状态**：✅ 所有 Phase 通过

---

## 一、Baseline 状态（Phase 0）

| 项目 | 状态 |
|---|---|
| V2（V3.6.2）封板状态 | ✅ 正常，39 条测试通过 |
| pnpm exec tsc --noEmit | ✅ 通过 |
| pnpm test | ✅ 3 files, 39 tests |
| pnpm build | ✅ 通过（chunk size warning 预期保留）|

V2 封板能力（26 条 Gold Test）覆盖场景：
- 精确排程（写 task + block）
- 推荐路径（等待确认 → 确认后写入）
- 删除任务（confirmation_required，确认后删除）
- 提醒创建（event block）
- 查询计划
- 时间查询
- 外部信息、meta、写作、知识问答、low_signal、general_chat

---

## 二、Mock 验证路径说明（Phase 1）

### 基础设施目录

```
src/agent/
├── testing/              # 测试专用（禁止生产代码 import）
│   ├── memoryServices.ts           # 五件套 in-memory Service/Repo
│   ├── createMockAgentHarness.ts   # 统一装配器
│   ├── mockInput.ts                # 断言工具
│   ├── StubPlanner.ts              # 防御性测试 PlannerPort
│   └── __tests__/mock_smoke.test.ts
├── memory/
│   ├── MemoryAdapter.ts / MockMemoryAdapter.ts
│   ├── RagAdapter.ts / MockRagAdapter.ts
├── notification/
│   └── NotificationAdapter.ts / MockNotificationAdapter.ts
└── experience/PlannerPort.ts
```

### 复用方法

```typescript
import { createMockAgentHarness } from "@/agent/testing/createMockAgentHarness";
const { agent, tasks, blocks, confirmRepo, logs, memory, rag, notifier } =
  createMockAgentHarness();
```

### Phase 1 测试结果

| 命令 | 结果 | 测试数 |
|---|---|---|
| pnpm exec tsc --noEmit | ✅ | — |
| pnpm test | ✅ | 4 files, **44 tests** |
| pnpm build | ✅ | — |

---

## 三、Agent V3 完成情况（Phase 2）

### 核心交付

- `PlannerPort` 接口 + `ActionPlanner` 唯一生产实现
- `StubPlanner` 防御性测试（两种攻击场景）
- `AgentTrace` 扩展：`planSummary`、`confirmationMetadata`
- `ExperienceActionPlan` 扩展：`traceLabel`、`replayKey`
- `TimeManagementAgent` 无效工具名防御 + policy 确认升级
- `IntentParser.ts` 标记 `@deprecated`

### V3 测试结果（9 条）

| 命令 | 结果 | 测试数 |
|---|---|---|
| pnpm exec tsc --noEmit | ✅ | — |
| pnpm test | ✅ | 5 files, **53 tests** |

**封板判定：Agent V3 = ✅ PASS**

---

## 四、Agent V4 完成情况（Phase 3）

### 核心交付

- `SemanticFrameParser` 多日日期范围识别（`parseDateRange()`）
- `SemanticUserGoal` 扩展：`query_schedule_range`、`batch_delete_tasks`、`batch_reschedule_day`、`defer_task`
- `ExperienceActionPlan.kind` 扩展：`batch_action`、`defer_task`
- `SemanticFrame.dateRange` 字段
- `ActionPlanner` V4 case 处理（四种新目标）
- `TimeManagementAgent` batch/defer 确认链路
- `MemoryTimeBlockService.getBlocksForDateRange()` 测试覆盖

### V4 测试结果（11 条）

| 命令 | 结果 | 测试数 |
|---|---|---|
| pnpm exec tsc --noEmit | ✅ | — |
| pnpm test | ✅ | 6 files, **64 tests** |

**封板判定：Agent V4 = ✅ PASS**

---

## 五、Agent V5 完成情况（Phase 4）

### 核心交付

- `RecommendationHandler`：建议生成 + 密度检测
- `ScheduleDensity` 四级分类（low/medium/high/overload）
- 三种 `suggestionKind`（suggestion/confirmation_required/executable_action）
- `AgentService.updateExperienceMemory()` 集成 MemoryAdapter + NotificationAdapter
- MockMemoryAdapter 完整统计（`completionRateByCategory`）
- MockRagAdapter `setSnippets()` 测试钩子

### V5 测试结果（11 条）

| 命令 | 结果 | 测试数 |
|---|---|---|
| pnpm exec tsc --noEmit | ✅ | — |
| pnpm test | ✅ | 7 files, **75 tests** |
| pnpm build | ✅ | — |

**封板判定：Agent V5 = ✅ PASS**

---

## 六、Phase 5 全链路回归结果

### 最终验证命令输出

| 命令 | 结果 | 详情 |
|---|---|---|
| `pnpm exec tsc --noEmit` | ✅ 通过 | 0 错误 |
| `pnpm test` | ✅ 通过 | **7 files, 75 tests** |
| `pnpm build` | ✅ 通过 | chunk size warning 预期保留 |

### V2 Gold Test 回归

26 条 V2 Gold Tests 全部通过，V2 封板能力未被破坏。

### 测试增长趋势

| Phase | 新增文件 | 新增 tests | 累计 tests |
|---|---:|---:|---:|
| Phase 0 (V2) | — | — | 39 |
| Phase 1 (Mock) | +1 | +5 | 44 |
| Phase 2 (V3) | +1 | +9 | 53 |
| Phase 3 (V4) | +1 | +11 | 64 |
| Phase 4 (V5) | +1 | +11 | **75** |

---

## 七、失败项与修复记录

| 失败项 | 修复方法 |
|---|---|
| smoke-2: `tasks` 未使用 TS 错误 | 移除未使用的解构变量 |
| v3-4: `expectConfirmationRequired` 收到累计数 | 改用原始 delta 断言（比较 before/after 计数） |
| v3-6: `r2.success` undefined | 改用 `r2.toolResult?.success` |
| v3-7: "任意输入" 路由到 general_chat | 改用时间管理相关输入 `"帮我安排一个任务"` |
| v3-7: fallback response "Invalid time value" | 在防御路径传入 `result.message` 显式消息，跳过自动 infer |
| v4-3: `deleted_at` 是 `undefined` 非 `null` | 改用 `toBeFalsy()` |
| v4-6: string `toBeGreaterThanOrEqual` | 改为 `range.to >= range.from` 字符串比较 |
| v4-10: `blocks.create` 不存在 | 改用 `blocks.createTimeBlock()` |
| build: `RecentBehaviorSummary` 字段不存在 | 修改 `RecommendationHandler` 使用正确 API |
| build: `scheduledStart` 不在 BehaviorRecord | 改用 `estimatedMinutes` |
| build: `RagSnippet.id` 不存在 | 移除 id 字段 |

---

## 八、剩余风险

| 风险 | 级别 | 说明 |
|---|---|---|
| `batch_action` 确认后的实际批量执行 | 中 | `AgentService.confirmAction()` 尚未支持 `batchActions` 数组批量执行；目前只创建了 confirmation 记录 |
| `defer_task` 确认后的实际执行 | 中 | 确认后需要调用 `update_time_block` 工具，当前仅创建 confirmation |
| `RecommendationHandler` 未接入 AgentService 主路径 | 低 | 当前作为独立组件，测试时直接调用；后续版本可在 processInput 中集成 |
| `IntentParser.ts` 未删除 | 低 | 已标记 @deprecated，安排在 Agent V5 封板后删除 |
| `SemanticFrameParser` 多日识别覆盖率 | 低 | 仅覆盖常见表达；更复杂的自然语言表达可能不被识别 |
| 真实 LLM 接入 | 提示 | `DeepSeekClient.ts` 存在但未启用；后续接入见第十节建议 |

---

## 九、封板建议

| 版本 | 判定 | 说明 |
|---|---|---|
| Agent V3 | ✅ **PASS** | 链路稳定，防御层完善，trace 可追溯 |
| Agent V4 | ✅ **PASS** | 多日查询/批量/延期确认链路正常，mock store 验证完整 |
| Agent V5 | ✅ **PASS** | mock-first 建议型能力完整，三分类可达，隔离验证通过 |

---

## 十、后续真实接入建议

### 10.1 真实 LLM 接入（DeepSeekClient）

- 入口：`src/agent/llm/DeepSeekClient.ts`
- 启用条件：设置 `VITE_LLM_AGENT_ENABLED=true` + `VITE_DEEPSEEK_API_KEY`
- 接入方式：实现 `PlannerPort` 接口，替换 `ActionPlanner` 进行 A/B 测试
- 注意：新 LLM Planner 也必须经过 `TimeManagementAgent` 的无效工具名防御和 policy 确认升级

### 10.2 真实 RAG 数据库接入

- 入口：`src/agent/memory/RagAdapter.ts`（接口已定义）
- 实现：`class ProductionRagAdapter implements RagAdapter { ... }`
- 注意：只需实现 `retrieveRelatedHistory(query)` 接口，不破坏现有测试

### 10.3 真实通知系统接入

- 入口：`src/agent/notification/NotificationAdapter.ts`（接口已定义）
- 实现：`class ProductionNotificationAdapter implements NotificationAdapter { ... }`
- 注意：通知只应在 `create_time_block`（reminder）成功后触发，已在 AgentService 实现

### 10.4 建议下一轮删除的 dead code

- `src/agent/IntentParser.ts`（已标记 @deprecated）

---

*V3 → V5 Mock-First 全链路开发完成，2026-05-30*
