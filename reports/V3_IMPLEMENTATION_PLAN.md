# Agent V3 Implementation Plan

> **Agent Track Version** — 不等于 Product V3，此编号仅代表 Agent 子线开发阶段。见 `docs/ROADMAP_REBASE_AFTER_AGENT_V5.md`。

**日期**：2026-05-30  
**阶段**：Phase 2 — Agent V3 链路稳定 + 防御层  

---

## 目标

将 router → planner → handler → boundary 链路打通成"可替换 planner 入口 + 严格防御层"，不接真实 LLM。

## Planner 设计

- `PlannerPort` 接口生产侧**唯一实现**是 `ActionPlanner`
- 测试侧使用 `StubPlanner` 注入异常 plan，验证防御
- 不新增 "rule" / "mock_llm" trace 标签
- `MockLLMPlanner` 名字不出现

## 核心变更

### 1. 类型扩展（`src/agent/types.ts`）

- `ExperienceActionPlan` 新增：
  - `traceLabel?: string` — 人类可读 trace 标签（如 `"create_and_schedule_task:exact"`）
  - `replayKey?: string` — 回放键（排除 id/createdAt 的确定性 hash）
  - `kind` 扩展：`"suggestion"` | `"defer_task"` | `"batch_action"`（为 V4/V5 预留）
- `AgentTrace` 新增：
  - `planSummary?: string` — 计划摘要
  - `confirmationMetadata?: { confirmationId, riskLevel, toolName }` — 确认链路元数据
  - `suggestionKind?: string` — 建议类响应分类（V5 预留）
  - `mode` 扩展：`"suggestion"`
  - `errorKind` 扩展：`"invalid_tool"` | `"policy_upgraded"`
- `SemanticUserGoal` 新增 V4+ 目标类型
- `SemanticFrame` 新增 `dateRange` 字段（V4+）

### 2. ActionPlanner 增强（`src/agent/experience/ActionPlanner.ts`）

每个 case 都填写了 `traceLabel` 和 `replayKey`：
- `create_and_schedule_task:exact` / `create_and_schedule_task:fuzzy_recommendation`
- `create_reminder:tool`
- `delete_task:confirmation_required` / `delete_task:not_found`
- `query_schedule:lookup`
- `{goal}:direct` / `{goal}:fallback`

### 3. TimeManagementAgent 增强（防御层）

- **无效工具名防御**：plan.toolName 未在 ToolRouter 注册时，返回 fallback 响应并记录 `errorKind: "invalid_tool"`；0 写库
- **Policy 强制确认**：`hasToolRequiringConfirmation()` 覆盖 planner 的 `requiresConfirmation`（防止 StubPlanner 绕过 delete_task 确认）
- trace 扩展：
  - confirmation 路径写入 `confirmationMetadata`
  - 所有路径写入 `planSummary`

### 4. IntentParser 标记废弃

`src/agent/IntentParser.ts` 顶部加 `@deprecated dead since V3.6.1` JSDoc

### 5. LLMClient 注释更新

`src/agent/llm/LLMClient.ts` 中"fallback 到规则 IntentParser"改为"fallback 到 boundary"

## V3 Mock 测试（9 条）

| # | 测试名 | 验证点 |
|---|---|---|
| v3-1 | reminder does not route to general_chat | 提醒路由回归 |
| v3-2 | reminder with multi-date input stays in time_management | 多日期混合路由 |
| v3-3 | trace contains planSummary after PlannerPort injection | planSummary 写入 |
| v3-4 | delete request enters confirmation_required with confirmationMetadata | confirmationMetadata |
| v3-5 | same input produces same traceLabel (replayable) | traceLabel 稳定性 |
| v3-6 | recommendation flow creates confirmation then writes on confirm | 推荐确认链路 |
| v3-7 | StubPlanner with nonexistent_tool is rejected, 0 writes | invalid_tool 防御 |
| v3-8 | StubPlanner bypassing confirmation is blocked for delete_task | policy 确认升级 |
| v3-9 | low_signal input does not bypass boundary | boundary 回归 |

---

*2026-05-30 Agent V3 实施计划*
