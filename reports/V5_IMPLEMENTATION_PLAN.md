# Agent V5 Implementation Plan

> **Agent Track Version** — 不等于 Product V5，此编号仅代表 Agent 子线开发阶段。见 `docs/ROADMAP_REBASE_AFTER_AGENT_V5.md`。

**日期**：2026-05-30  
**阶段**：Phase 4 — Agent V5 建议型 Agent  

---

## 目标

Agent 能基于"历史数据"和"当前计划密度"给建议，但建议永远是 suggestion，不绕过确认。

## 核心变更

### 1. RecommendationHandler（新建）

`src/agent/time-management/RecommendationHandler.ts`

功能：
- `generateRecommendation(context, blocks)` — 基于当日 blocks 和 mock 历史生成建议
- `detectScheduleDensity(blocks)` — 密度分类：`low/medium/high/overload`
- `fetchHistoryInsights()` — 从 MemoryAdapter + RagAdapter 获取洞察

建议分类（`RecommendationResult.suggestionKind`）：
- `"suggestion"` — 只读建议，不写库，不发通知，`shouldNotify: false`
- `"confirmation_required"` — overload 时，带 `proposedAction`，需要用户确认
- `"executable_action"` — 计划合理，无需操作

密度阈值：
- `low`: < 3h / 任意块数
- `medium`: 3h - 6h
- `high`: > 6h
- `overload`: ≥ 8h 或 ≥ 8 个块

### 2. AgentService 集成 MemoryAdapter + NotificationAdapter

`src/agent/AgentService.ts` — `updateExperienceMemory()` 扩展：
- 成功执行 `schedule_task` 后调用 `memoryAdapter.recordSchedule()`（在 ToolRouter execute 后，不在 Tool 内）
- 成功执行 `create_time_block`（reminder）后调用 `notificationAdapter.notify()`
- suggestion 路径不触发以上两个操作

### 3. MockMemoryAdapter 完善

已有接口，V5 阶段通过 `recordSchedule()` / `recordTaskCompletion()` 填入语义数据，
`getRecentBehavior()` 返回真实统计（`completionRateByCategory`、`avgBlocksPerDay`）。

### 4. MockRagAdapter 完善

新增 `setSnippets()` 方法，允许测试注入自定义摘要数据。

## V5 Mock 测试（11 条）

| # | 测试名 | 验证点 |
|---|---|---|
| v5-1 | memory records behavior after schedule_task | MemoryAdapter 集成 |
| v5-2 | notifier receives event after reminder | NotificationAdapter 集成 |
| v5-3 | suggestion path no notification, no writes | suggestion 不副作用 |
| v5-4 | overload → confirmation_required | 密度过载分类 |
| v5-5 | low completion rate → buffer suggestion | memory 洞察 |
| v5-6 | rag snippet incorporated in message | RAG 集成 |
| v5-7 | schedule writes memory, suggestion does not | 内存写入区分 |
| v5-8 | detectScheduleDensity correctly classifies | 密度分类单元测试 |
| v5-9 | MockRagAdapter never calls real fetch | 隔离验证 |
| v5-10 | suggestion does not trigger notification | 通知隔离 |
| v5-11 | all three suggestionKind values are reachable | 三分类覆盖 |

---

*2026-05-30 Agent V5 实施计划*
