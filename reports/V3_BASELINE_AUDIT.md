# V3 Baseline Audit Report

**日期**：2026-05-30  
**阶段**：Phase 0 — Baseline Audit  
**目的**：确认 Agent V2（V3.6.2）封板状态未漂移，建立 V3 开发起点基线。

---

## 一、验证命令结果

| 命令 | 结果 | 备注 |
|---|---|---|
| `pnpm exec tsc --noEmit` | ✅ 通过 | 无类型错误 |
| `pnpm test` | ✅ 通过 | 3 files, 39 tests |
| `pnpm build` | ✅ 通过 | Vite chunk size warning（JS 580kB > 500kB），非阻塞 |

**测试文件分布**：

| 测试文件 | 条数 |
|---|---:|
| `src/agent/__tests__/agent_router_gold.test.ts` | 26 |
| `src/agent/experience/__tests__/v3_6_1_pipeline.test.ts` | 8 |
| `src/agent/experience/__tests__/response_boundary.test.ts` | 5 |
| **合计** | **39** |

---

## 二、V2 封板能力边界（来源：docs/V3.6/V3.6.2-closure-report.md）

| # | 封板项 | 实现位置 |
|---|---|---|
| 1 | `AgentDomainRouter` 8 domain 正确路由 | `src/agent/router/AgentDomainRouter.ts` |
| 2 | `TimeManagementAgent` 主链路闭环（exact/fuzzy/delete/reminder/future/query） | `src/agent/time-management/TimeManagementAgent.ts` |
| 3 | `LLMDirectHandler` 只读（不写库、不触发 ToolRouter、不返回 refreshHints） | `src/agent/handlers/LLMDirectHandler.ts` |
| 4 | `ExternalInfoHandler` 诚实无工具提示（不伪造数据） | `src/agent/handlers/ExternalInfoHandler.ts` |
| 5 | `ResponseBoundary` / `ResponseComposer` 统一出口（内部名不外泄） | `src/agent/experience/ResponseBoundary.ts` |
| 6 | `SemanticFrameParser` 只做 time-management 内部语义（无 greeting/identity 分支） | `src/agent/experience/SemanticFrameParser.ts` |
| 7 | `RecommendationPlanner` 候选按 timezone 计算，用户确认后才写入 | `src/agent/time-management/scheduling/RecommendationPlanner.ts` |
| 8 | Gold Test ≥ 16 cases，覆盖 8 domain + fallback | `src/agent/__tests__/agent_router_gold.test.ts`（26 条） |
| 9 | `tsc` / `test` / `build` 全绿 | 已在本轮验证 |

---

## 三、现有 Agent 层文件清单（V3 起点）

### 主链路（活跃）

| 文件 | 角色 |
|---|---|
| `src/agent/AgentService.ts` | 主入口，装配 Router/Handler/Agent/Tools |
| `src/agent/router/AgentDomainRouter.ts` | 8 domain 分发 |
| `src/agent/time-management/TimeManagementAgent.ts` | 时间管理主链路 |
| `src/agent/experience/SemanticFrameParser.ts` | 语义解析（正则+关键词字典）|
| `src/agent/experience/ActionPlanner.ts` | Plan 工厂（按 userGoal 生成 ExperienceActionPlan）|
| `src/agent/experience/ResponseBoundary.ts` | 统一出口 + 内部名 sanitize |
| `src/agent/experience/ResponseComposer.ts` | 消息组合 |
| `src/agent/experience/ConversationContextBuilder.ts` | 上下文快照构建 |
| `src/agent/experience/dateFormatting.ts` | 日期格式化工具 |
| `src/agent/types.ts` | 所有 Agent 类型契约 |
| `src/agent/ToolRouter.ts` | 工具注册表 + 路由执行 |

### Handlers（活跃）

| 文件 | 角色 |
|---|---|
| `src/agent/handlers/AgentHandler.ts` | Handler 接口定义 |
| `src/agent/handlers/LLMDirectHandler.ts` | general_chat / knowledge_qa / writing_assistant（只读）|
| `src/agent/handlers/ExternalInfoHandler.ts` | external_info（诚实无工具）|
| `src/agent/handlers/MetaHandler.ts` | assistant_meta |
| `src/agent/handlers/FeedbackHandler.ts` | feedback_or_complaint |
| `src/agent/handlers/LowSignalHandler.ts` | low_signal |

### 调度子模块（活跃）

| 文件 | 角色 |
|---|---|
| `src/agent/time-management/scheduling/AvailabilityProvider.ts` | 空闲时段查询 |
| `src/agent/time-management/scheduling/RecommendationPlanner.ts` | 推荐候选生成 |
| `src/agent/time-management/scheduling/SchedulingReasoner.ts` | 排程推理 |

### LLM Adapter（保留但不在主链路启用）

| 文件 | 状态 |
|---|---|
| `src/agent/llm/LLMClient.ts` | 接口定义，活跃 |
| `src/agent/llm/DeepSeekClient.ts` | 生产实现，`VITE_LLM_AGENT_ENABLED=false` 时不调 |
| `src/agent/llm/contextBuilder.ts` | LLM 上下文构建，活跃 |
| `src/agent/llm/prompts.ts` | System prompt，活跃 |
| `src/agent/llm/schemas.ts` | Zod schema，活跃 |
| `src/agent/LLMPlanner.ts` | LLM 计划层，活跃（但 `VITE_LLM_AGENT_ENABLED` 默认 false）|

### Dead Code（需标记）

| 文件 | 状态 |
|---|---|
| `src/agent/IntentParser.ts` | **孤儿代码**：全局 0 import，V3.6.1 改造后遗弃。包含 `PatternRule` / `class IntentParser`（V1/V2.5 旧正则解析器）。Phase 2 标记 `@deprecated`。 |

### 17 个 Tool 文件（V2 封板，V3+ 不改）

`src/agent/tools/task/`（5 个）、`src/agent/tools/timeblock/`（5 个）、`src/agent/tools/schedule/`（5 个）、`src/agent/tools/explain/`（2 个）

---

## 四、缺失（V3 待建）

| 缺失项 | 计划 Phase |
|---|---|
| `reports/` 目录 | Phase 0（已创建）|
| `src/agent/testing/` 公共 mock 基础设施 | Phase 1 |
| `src/agent/experience/PlannerPort.ts` 接口 | Phase 1 |
| `src/agent/memory/` (MemoryAdapter / RagAdapter) | Phase 1 骨架，Phase 4 语义 |
| `src/agent/notification/` (NotificationAdapter) | Phase 1 骨架，Phase 4 语义 |
| `src/agent/testing/StubPlanner.ts` | Phase 2 |
| `AgentTrace.planSummary / confirmationMetadata` 字段 | Phase 2 |
| `ExperienceActionPlan.traceLabel / replayKey` 字段 | Phase 2 |
| 多日 TimeBlock 处理（dateRange / getBlocksForDateRange） | Phase 3 |
| V5 建议型响应（suggestion/confirmation_required/executable_action 三分类） | Phase 4 |

---

## 五、命令说明

项目实际使用命令（来自 `package.json`）：

```powershell
pnpm exec tsc --noEmit   # TypeScript 类型检查（无输出文件）
pnpm test                # vitest run（等价于 pnpm exec vitest run）
pnpm build               # tsc && vite build
```

Vite chunk size warning（JS 580kB > 500kB）属于体积提示，**不阻塞封板**，与 V2 closure report 记录一致。

---

## 六、结论

- V2（V3.6.2）封板状态完整，39 条测试全绿，类型检查通过，构建通过。
- V3 开发可以安全从当前基线起步。
- 下一步：Phase 1 建立统一 Mock 验证路径。

*生成于 Agent V3 Phase 0 Baseline Audit，2026-05-30*
