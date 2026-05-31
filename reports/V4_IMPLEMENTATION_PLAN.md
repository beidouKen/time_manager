# Agent V4 Implementation Plan

> **Agent Track Version** — 不等于 Product V4，此编号仅代表 Agent 子线开发阶段。见 `docs/ROADMAP_REBASE_AFTER_AGENT_V5.md`。

**日期**：2026-05-30  
**阶段**：Phase 3 — Agent V4 多日 + 批量 + 延期建议  

---

## 目标

让 Agent 能真正"操作"多天计划，但所有高风险动作走确认链路。

## 核心变更

### 1. SemanticFrameParser 扩展（`src/agent/experience/SemanticFrameParser.ts`）

新增检测能力：
- `query_schedule_range`：未来三天、这周、今天和明天等
- `batch_delete_tasks`：删除今天/明天/这周所有任务
- `defer_task`：延期/推迟到明天/下周

新增 `parseDateRange()` 方法：
- 支持"未来三天"→ {from: today, to: today+2}
- 支持"今天和明天"→ {from: today, to: today+1}
- 支持"明天和后天"→ {from: tomorrow, to: day+2}
- 支持"这周/本周"→ {from: 本周一, to: 本周日}
- 支持"下周"→ {from: 下周一, to: 下周日}
- 解析结果填入 `SemanticFrame.dateRange`

### 2. ActionPlanner 扩展（`src/agent/experience/ActionPlanner.ts`）

新增 case：
- `query_schedule_range`：只读多日查询，kind=`query_schedule`，带 dateRange params
- `batch_delete_tasks`：kind=`batch_action`，`requiresConfirmation: true`，`riskLevel: "destructive"`
- `batch_reschedule_day`：kind=`batch_action`，同上
- `defer_task`：kind=`defer_task`，`requiresConfirmation: true`，`riskLevel: "confirm"`；返回建议，不直接改原计划

### 3. TimeManagementAgent V4 分支

新增 `batch_action` 和 `defer_task` 处理：
- 自动创建 confirmation，填入 `confirmationId`
- 消息提示用户确认内容

### 4. MemoryTimeBlockService 扩展

`getBlocksForDateRange(from: Date, to: Date)` — 已在 Phase 1 中预建，V4 开始测试覆盖。

## V4 Mock 测试（11 条）

| # | 测试名 | 验证点 |
|---|---|---|
| v4-1 | multi-day query returns dateRange | 多日查询解析 |
| v4-2 | batch delete → confirmation, rejected = 0 writes | 批量删除确认 |
| v4-3 | defer_task → suggestion, no silent write | 延期不改原计划 |
| v4-4 | batch delete creates pending confirmation | 确认记录创建 |
| v4-5 | multi-day create requires confirmation | 多日创建确认 |
| v4-6 | today+tomorrow query recognized as multi-day | 多日识别 |
| v4-7 | single-day exact schedule regression | 单日回归 |
| v4-8 | defer_task rejected keeps original block | 延期拒绝后原 block 不变 |
| v4-9 | batch_delete plan has destructive riskLevel | 风险等级 |
| v4-10 | MemoryTimeBlockService.getBlocksForDateRange | store API 验证 |
| v4-11 | batch reschedule boundary (no silent writes) | 高风险边界 |

---

*2026-05-30 Agent V4 实施计划*
