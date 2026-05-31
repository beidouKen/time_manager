# Time Manager 5.30 Architecture Audit

**审计日期**：2026-05-30  
**审计对象**：当前代码库、`docs/`、`reports/` 中的阶段文档与封板报告  
**验证命令**：

```powershell
pnpm.cmd exec tsc --noEmit
pnpm.cmd test
```

结果：`tsc --noEmit` 通过；`pnpm test` 通过，7 个测试文件、75 条测试全绿。

---

## 1. 总体结论

当前项目不应再按原始路线图简单判定为 V3 或 V4。更准确的阶段判断是：

> **项目核心时间管理闭环已完成到 V2.5，Agent 主线已提前推进到“Agent V5 mock-first 验证完成”，但原始路线图中的 V4 OCR/外部导入、真实 V5 自适应记忆、V6 Planning RAG、V7/V8 尚未真正进入生产实现。**

因此，下一阶段不建议继续开新大版本，而应进入一个 **Integration Freeze / Roadmap Rebase** 阶段：

1. 先把已经提前完成的 Agent 子线纳入整体版本体系。
2. 明确“Agent V4/V5”与原始路线图“产品 V4/V5”不是同一件事。
3. 关闭当前架构偏离点，尤其是 Agent 旁路 Service、batch/defer 确认后不可执行、mock memory/RAG 未生产化。
4. 再决定是否回到原始 V4 OCR/导入，或将其推迟，让 Agent + Heartbeat 先形成稳定可用闭环。

---

## 2. 当前主要模块

| 模块 | 目录 / 文件 | 当前作用 |
|---|---|---|
| App Shell / Desktop | `src-tauri/`、`src/App.tsx` | Tauri 2 桌面壳，启动时执行 SQLite migration |
| UI Pages | `src/pages/TodayPage.tsx`、`ChatPage.tsx`、`SettingsPage.tsx` | 今日视图、聊天入口、设置页 |
| UI Components | `src/components/todo/`、`timeline/`、`heartbeat/`、`chat/` | Task、TimeBlock、Heartbeat、Chat 交互界面 |
| Store | `src/store/taskStore.ts`、`timeBlockStore.ts`、`heartbeatStore.ts`、`chatStore.ts` | Zustand 状态和 UI 操作入口 |
| Types | `src/types/*.ts`、`src/agent/types.ts` | Task / TimeBlock / Heartbeat / Agent 类型契约 |
| DB / Migration | `src/db/client.ts`、`src/db/migrations.ts` | SQLite 连接和 4 个 migration 版本 |
| Repository | `src/repositories/interfaces/`、`src/repositories/sqlite/` | Repository interface 与 SQLite 实现 |
| Service | `src/services/` | Task、TimeBlock、Schedule、Heartbeat、ActionLog、Confirmation 业务层 |
| Rule Scheduling | `src/lib/scheduler.ts`、`conflictDetector.ts` | 空闲槽、重排、冲突检测 |
| Agent Tooling | `src/agent/tools/`、`ToolRouter.ts`、`BaseTool.ts` | 17 个 Tool 和统一执行器 |
| Agent Orchestration | `src/agent/AgentService.ts`、`time-management/TimeManagementAgent.ts` | Domain Router 后的 Agent 主入口与时间管理子 Agent |
| Agent Experience | `src/agent/experience/` | 语义解析、动作规划、响应边界、上下文构建 |
| Agent Memory / RAG / Notification | `src/agent/memory/`、`notification/` | mock-first 适配器接口与测试实现 |
| Agent Tests | `src/agent/__tests__/`、`src/agent/testing/` | 75 条 mock-first 回归测试 |
| Reports / Version Docs | `docs/`、`reports/` | V0-V3.6、Agent V3-V5 文档和封板报告 |

---

## 3. 版本状态判定

| 版本能力 | 状态 | 判断依据 | 备注 |
|---|---|---|---|
| V0 Time Management Core | **Done** | `TaskService`、`TimeBlockService`、`ScheduleService`、SQLite schema、Todo / Timeline UI 完整；`docs/v0-closure-report.md` 已封板 | 本地 Task / TimeBlock / Timeline 闭环成立 |
| V1 Rule-based Scheduling | **Partial** | `src/lib/scheduler.ts` 支持 free slots、priority sort、day reschedule；`RescheduleDayTool` 可执行重排 | 有规则排程能力，但缺少完整规则配置、工作时间策略 UI、复杂约束、周期任务等产品化能力 |
| V2 Heartbeat + Feedback | **Done** | `HeartbeatService`、`heartbeatStore`、Heartbeat UI、执行状态字段、Done/Skip/Delay 联动和日志已存在 | 仍有小限制：无系统通知、跨日处理弱、修改 interval 需重开 |
| V2.5 Agent Tool Contract | **Done** | `ToolRouter`、17 个 Tool、`ActionLogService`、`ConfirmationService`、`CONFIRMATION_POLICY`、metadata 均已具备 | 是当前 Agent 安全边界的主要基础 |
| V3 Agent Tooling MVP | **Done** | `AgentDomainRouter`、`TimeManagementAgent`、`ActionPlanner`、`ResponseBoundary`、Gold Tests 覆盖 8 domain 和时间管理主链路 | 当前主路是 domain-router + experience planner；真实 DeepSeek LLM 文件存在但未接入 `AgentService` 主路 |
| V4 OCR / Schedule Import | **Not started** | 未发现 OCR、图片解析、外部日程导入、Calendar import 相关生产代码 | `reports/V4_*` 指的是 Agent V4 多日/batch/defer，不是原始产品 V4 |
| V5 Adaptive Scheduling Memory | **Partial** | `MemoryAdapter`、`MockMemoryAdapter`、`RagAdapter`、`RecommendationHandler` 存在，V5 测试通过 | 当前是 mock-first 建议能力，不是真实持久化记忆，也未完整接入用户主路径 |
| V6 Planning RAG / Plan Mode | **Skeleton only** | `RagAdapter`、`PlannerPort`、`PlanProposal`、`ResponseBoundary` 提供接口雏形 | 无真实向量库、无计划知识库、无 Plan Mode UI / 会话模式 |
| V7 Local Workspace Agent | **Not started** | 无本地文件系统 workspace agent、项目索引、代码/文件操作工具 | 当前 Tauri 只用于桌面壳和 SQLite |
| V8 Executor Plugin System | **Not started** | `ToolRouter` 是内置工具注册表，不是插件系统 | 没有插件 manifest、动态加载、权限沙箱或 executor plugin contract |

---

## 4. 已完成能力

### 4.1 Core Time Management

- Task / TimeBlock 数据模型分离，SQLite migration 已覆盖 `tasks`、`time_blocks`、Agent 日志、确认和会话表。
- V0 交互闭环完整：Task CRUD、TimeBlock CRUD、Task 排期到 TimeBlock、TimeBlock 移回 Todo。
- 基础冲突检测、时间合法性校验、软删除和 Task 状态联动已实现。
- Heartbeat 执行反馈闭环完成：开始前提醒、开始提示、结束反馈、Done/Skip/Delay、Task 状态联动。

### 4.2 Agent Tooling

- Tool contract 已成型：`BaseTool`、`ToolRouter`、17 个 Tool。
- Tool 内部基本都只调用 Service，不直接访问 Repository / DB。
- 删除、重排等危险操作通过 Tool `requiresConfirmation` 和 ConfirmationService 进入确认链路。
- Agent 操作有 `agent_action_logs`，Chat 消息有 `metadata_json` 和 `agentTrace`。
- Domain Router 已把时间管理、闲聊、知识问答、写作、外部信息、反馈、低信号等输入分开。
- 非时间管理 handler 保持只读，不写 Task / TimeBlock。

### 4.3 Agent Advanced Mock Track

- Agent V3/V4/V5 mock-first 测试链路已完成，75 tests 全绿。
- V4 Agent 多日查询、batch/delete/defer 语义已有测试和部分确认链路。
- V5 建议型 Agent 的 Memory/RAG/Notification 适配器接口和 mock 行为已建立。

---

## 5. 未完成能力

| 能力 | 当前缺口 |
|---|---|
| 真实 LLM 主路 | `DeepSeekClient`、`LLMPlanner` 存在，但当前 `AgentService` 没有实例化或调用它们；`LLMDirectHandler` 只是只读模板化 handler |
| OCR / 图片日程导入 | 无 OCR pipeline、无图片上传/识别、无导入确认 UI |
| 外部日历导入 | 无 Google / Apple / ICS / CSV 导入模型或 Service |
| 自适应记忆生产化 | 只有 mock memory/RAG；无持久化行为库、无真实检索、无隐私/清理策略 |
| Planning RAG / Plan Mode | 缺真实 RAG store、计划生成 UI、候选计划编辑/确认流 |
| Batch / defer 确认后执行 | 当前会创建 confirmation，但 `confirmAction()` 只会按 `tool_name` 调 ToolRouter；`batch_action` / `defer_task` 不是注册 Tool，确认后无法真正完成预期操作 |
| Local Workspace Agent | 无 workspace 文件系统工具和权限边界 |
| Executor Plugin System | 无插件协议、插件加载、插件权限、插件测试 harness |
| 全局版本映射 | 文档中 V1/V4/V5 命名与原始路线图冲突，需要重命名或建立映射表 |

---

## 6. Agent 架构原则检查

| 原则 | 结论 | 说明 |
|---|---|---|
| Agent 不直接改数据库 | **基本符合** | `src/agent/` 没有直接使用 `Database.load` / SQL 写入；写操作主要经 ToolRouter → Tool → Service |
| Agent 只能调用 Tool | **Partial** | 写操作基本经 Tool；但 `ActionPlanner` 直接调用 `TaskService.getTasks()` 做任务解析，`TimeManagementAgent` 直接调用 `TimeBlockService.getBlocksByTaskId()` 做查询，属于读路径旁路 Tool |
| Tool 内部调用 Service | **符合** | `src/agent/tools/**` 基本只依赖 `TaskService` / `TimeBlockService` / `ScheduleService` |
| 危险操作必须经过 ConfirmationPolicy | **部分符合** | 删除和重排工具有确认；`LLMPlanner` 使用 `CONFIRMATION_POLICY` 覆盖 LLM 输出；但 `TimeManagementAgent` 主要依据 `tool.requiresConfirmation` 和 actionPlan，未统一按 `CONFIRMATION_POLICY` 计算；batch/defer 另走自定义确认 |
| 所有 Agent 操作必须留下 ActionLog 或 Trace | **基本符合** | `processInput()`、`confirmAction()`、`rejectAction()` 均写日志；metadata 有 trace；Heartbeat/timeline 操作也写日志。独立调用 `RecommendationHandler` 的测试路径不代表生产日志闭环 |
| UI 不直接写数据库 | **部分符合** | 组件层基本通过 Store；但 `chatStore.ts` 直接实例化 `SqliteConversationRepository`，绕过了 ConversationService，属于 Store 层直连 Repository |
| Task 和 TimeBlock 不能混在一起 | **符合** | 模型、表、Service 分离；跨实体操作集中在 `ScheduleService` 或 Agent Tool 中 |
| Heartbeat 只是 Trigger Engine，不是 Agent 大脑 | **符合** | `HeartbeatService.evaluateNow()` 是触发评估；状态转换通过 Service，未承担 Agent 推理或规划 |

---

## 7. 架构偏离点

### 7.1 版本语义已经漂移

文档里存在两套版本体系：

- 原始产品路线：V4 = OCR/外部日程导入，V5 = 自适应排程记忆。
- 当前 Agent 子线：Agent V4 = 多日/batch/defer，Agent V5 = mock memory/RAG suggestion。

这会导致后续排期误判。建议立刻建立 `PRODUCT_VERSION` 与 `AGENT_TRACK_VERSION` 的映射文档。

### 7.2 Agent 读路径绕过 Tool

`ActionPlanner` 和 `TimeManagementAgent` 直接读取 Service，虽然没有直接写库，但与“Agent 只能调用 Tool”的硬原则不完全一致。短期可接受，长期建议把这些读操作也工具化：

- `resolve_task_reference`
- `get_task_schedule`
- `query_time_blocks_by_task`

### 7.3 batch/defer 确认链路未闭环

V4 Agent 已经能创建 `batch_action` / `defer_task` confirmation，但确认后 `confirmAction()` 会尝试执行 `confirmation.tool_name`。当前 `ToolRouter` 未注册 `batch_action` / `defer_task`，因此这类确认只是记录，不是真正执行。

### 7.4 真实 LLM 当前不在主路

`src/agent/llm/` 和 `LLMPlanner.ts` 存在，但 `AgentService` 当前没有接入 `DeepSeekClient` / `LLMPlanner`。所以当前 Agent 是规则/语义 parser + mock-first 规划，不是在线 LLM Agent。

### 7.5 V5 Memory/RAG 仍是 mock-first

`RecommendationHandler` 的能力被测试证明，但主要是独立处理器；真实数据来源、持久化、检索、与主 Agent 路由的连接还未完成。

### 7.6 Chat 持久化缺 Service 边界

`chatStore.ts` 直接使用 `SqliteConversationRepository`。这不等于组件直接写 SQL，但已经绕过 Service 层。建议新增 `ConversationService`，让 Store 只依赖 Service。

---

## 8. 下一阶段建议

### P0：做一次 Roadmap Rebase

新建一个路线重排文档，建议命名：

```text
docs/ROADMAP_REBASE_AFTER_AGENT_V5.md
```

建议映射：

| 新阶段 | 内容 |
|---|---|
| R0 Stabilization | 保持 V0-V2.5 core + Agent V5 mock-first 全绿 |
| R1 Agent Integration Freeze | 修复 Tool-only、batch/defer、ConversationService、LLM 主路选择 |
| R2 Import/OCR | 回到原始 V4：OCR / external calendar / schedule import |
| R3 Production Memory | 回到原始 V5：真实 memory/RAG、自适应排程 |
| R4 Plan Mode | 原始 V6：Planning RAG + Plan Mode |
| R5 Workspace / Plugin | 原始 V7/V8 |

### P1：收紧 Agent 边界

- 将 `ActionPlanner` 中的 TaskService 读取改为 Tool 或 ReferenceResolver。
- 将 `TimeManagementAgent` 的直接查询改为 read-only Tool。
- 让 `TimeManagementAgent` 使用统一 `CONFIRMATION_POLICY` 判断风险，而不只看 Tool flag。
- 为 `batch_action` / `defer_task` 设计真正的 Tool 或在 `confirmAction()` 中显式处理。

### P1：决定真实 LLM 策略

二选一：

1. **保持本地规则 Agent 为主路**：把 `LLMPlanner` / `DeepSeekClient` 标为 experimental，并从版本状态中降级。
2. **恢复真实 LLM 主路**：将 `LLMDirectHandler` 接入 LLMClient，并保证工具计划仍经过 ToolRouter + ConfirmationPolicy。

### P2：生产化 Memory/RAG

- 先定义本地行为记录表或复用 action logs，明确 privacy 和 retention。
- 将 `MemoryAdapter` 从 mock 切到本地持久实现。
- 将 RAG 从 `MockRagAdapter` 扩展为本地摘要检索，而不是直接引入复杂向量库。

### P2：回到产品 V4 导入能力

- 先做非 OCR 的结构化导入：ICS / CSV / 手动粘贴文本。
- OCR 作为第二步，不要直接把 OCR、解析、排程、确认一次性做完。
- 所有导入结果必须进入 PlanProposal / Confirmation 流，不直接写 Timeline。

---

## 9. 需要进一步检查的文件列表

### Agent 主链路

- `src/agent/AgentService.ts`
- `src/agent/time-management/TimeManagementAgent.ts`
- `src/agent/experience/ActionPlanner.ts`
- `src/agent/experience/SemanticFrameParser.ts`
- `src/agent/router/AgentDomainRouter.ts`
- `src/agent/ToolRouter.ts`
- `src/agent/types.ts`

### Confirmation / Log / Trace

- `src/services/ConfirmationService.ts`
- `src/services/ActionLogService.ts`
- `src/repositories/sqlite/SqliteConfirmationRepository.ts`
- `src/repositories/sqlite/SqliteActionLogRepository.ts`
- `src/store/chatStore.ts`
- `src/components/chat/ChatMessage.tsx`

### Core Service / Boundary

- `src/services/TaskService.ts`
- `src/services/TimeBlockService.ts`
- `src/services/ScheduleService.ts`
- `src/services/HeartbeatService.ts`
- `src/store/timeBlockStore.ts`
- `src/store/heartbeatStore.ts`

### Scheduling / Memory / RAG

- `src/lib/scheduler.ts`
- `src/agent/time-management/scheduling/AvailabilityProvider.ts`
- `src/agent/time-management/scheduling/RecommendationPlanner.ts`
- `src/agent/time-management/RecommendationHandler.ts`
- `src/agent/memory/MemoryAdapter.ts`
- `src/agent/memory/MockMemoryAdapter.ts`
- `src/agent/memory/RagAdapter.ts`
- `src/agent/memory/MockRagAdapter.ts`

### LLM Experimental Path

- `src/agent/LLMPlanner.ts`
- `src/agent/llm/DeepSeekClient.ts`
- `src/agent/llm/LLMClient.ts`
- `src/agent/llm/contextBuilder.ts`
- `src/agent/llm/prompts.ts`
- `src/agent/llm/schemas.ts`

### Product V4/V5 Gap

- 当前未发现 OCR / calendar import / workspace / plugin executor 生产文件。后续新增前应先建立对应目录和设计文档，避免继续挤进 `src/agent/time-management/`。

---

## 10. 最终判定

当前项目已经越过“普通 Todo List”阶段，核心定位已经接近：

> **本地个人时间管理核心 + Heartbeat 执行反馈 + Agent Tooling / Planning mock-first 骨架。**

但它还不是完整的自适应个人计划管理助手。真正缺口不在“再多写几个 Agent case”，而在把提前完成的 Agent 主线安全地整合回产品主线：统一版本语义、收紧 Tool-only 边界、完成确认后执行闭环、接上真实记忆/导入能力。

建议下一步版本名称不要叫 V6，也不要直接叫 V4。更合适的是：

> **V3.7 Integration Freeze：Agent 主线并轨与产品路线重排。**
