# Phase 1 Mock 验证路径 Closure Report

**日期**：2026-05-30  
**阶段**：Phase 1 — 统一 Mock 验证路径  
**结论**：✅ 通过

---

## 一、验证命令结果

| 命令 | 结果 | 测试数 |
|---|---|---|
| `pnpm exec tsc --noEmit` | ✅ 通过 | — |
| `pnpm test` | ✅ 通过 | 4 files, **44 tests** |
| `pnpm build` | ✅ 通过 | chunk size warning 保留 |

**测试数对比**：

| 阶段 | 测试文件数 | 测试条数 |
|---|---:|---:|
| Phase 0 (V2 封板) | 3 | 39 |
| Phase 1 新增 | +1 | +5 |
| **Phase 1 合计** | **4** | **44** |

---

## 二、新增文件清单

### 接口层（生产代码可引用）

| 文件 | 说明 |
|---|---|
| `src/agent/experience/PlannerPort.ts` | Planner 抽象接口 |
| `src/agent/memory/MemoryAdapter.ts` | 行为记录接口 |
| `src/agent/memory/RagAdapter.ts` | RAG 检索接口 |
| `src/agent/notification/NotificationAdapter.ts` | 通知发送接口 |

### Mock 实现层（生产代码可选注入）

| 文件 | 说明 |
|---|---|
| `src/agent/memory/MockMemoryAdapter.ts` | 进程内行为记录（dump/clear）|
| `src/agent/memory/MockRagAdapter.ts` | 固定摘要 RAG 实现（setSnippets）|
| `src/agent/notification/MockNotificationAdapter.ts` | 进程内通知收集（drain/peek/clear）|

### 测试专用层（禁止生产代码 import）

| 文件 | 说明 |
|---|---|
| `src/agent/testing/memoryServices.ts` | 五件套 in-memory Service/Repo |
| `src/agent/testing/createMockAgentHarness.ts` | 统一装配器 |
| `src/agent/testing/mockInput.ts` | 断言工具函数 |
| `src/agent/testing/StubPlanner.ts` | 防御性测试 PlannerPort |
| `src/agent/testing/__tests__/mock_smoke.test.ts` | 5 条 smoke tests |

### 报告层

| 文件 | 说明 |
|---|---|
| `reports/V3_BASELINE_AUDIT.md` | Phase 0 基线报告 |
| `reports/MOCK_VERIFICATION_GUIDE.md` | Mock 验证路径使用指南 |
| `reports/PHASE_1_MOCK_CLOSURE_REPORT.md` | 本报告 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `src/agent/experience/ActionPlanner.ts` | 加 `implements PlannerPort` |
| `src/agent/time-management/TimeManagementAgent.ts` | 依赖从 `actionPlanner: ActionPlanner` 改为 `plannerPort: PlannerPort` |
| `src/agent/AgentService.ts` | 新增可选依赖 `plannerPort/memoryAdapter/ragAdapter/notificationAdapter`；字段从 `actionPlanner` 改为 `plannerPort`；构造器注入逻辑更新 |

---

## 三、Smoke Test 结果

| # | 测试名 | 结果 | 覆盖场景 |
|---|---|---|---|
| 1 | smoke-1: exact schedule writes 1 task and 1 block | ✅ | 明确时间排程写入 |
| 2 | smoke-2: reminder input routes to time_management | ✅ | 提醒不走 general_chat |
| 3 | smoke-3: delete request returns confirmation_required | ✅ | 删除必须确认 |
| 4 | smoke-4: mock store write only via ToolRouter | ✅ | 写库链路可追溯 |
| 5 | smoke-5: ResponseBoundary no internal names | ✅ | boundary sanitize |

---

## 四、V2 封板回归

原有 39 条测试全部通过（4 files 中的前 3 个文件）：

- `src/agent/__tests__/agent_router_gold.test.ts`: 26 条 ✅
- `src/agent/experience/__tests__/v3_6_1_pipeline.test.ts`: 8 条 ✅
- `src/agent/experience/__tests__/response_boundary.test.ts`: 5 条 ✅

---

## 五、设计决定记录

1. **PlannerPort 唯一生产实现**：`ActionPlanner implements PlannerPort`，不新增 "rule" / "mock_llm" 标签。
2. **StubPlanner 隔离**：仅在 `src/agent/testing/` 下，禁止被 `AgentService` 默认装配。
3. **适配器可选注入**：`memoryAdapter/ragAdapter/notificationAdapter` 默认 `undefined`，不传时行为与 V2 完全一致。
4. **MemoryTimeBlockService 预先支持 getBlocksForDateRange**：为 V4 多日查询准备，但 V3 阶段不调用。

---

*Phase 1 Mock 验证路径搭建完成，2026-05-30*
