# Project Structure And Logic

**生成日期**：2026-05-30  
**范围**：`src/`、`src-tauri/`、主要配置文件与测试辅助代码  
**定位**：帮助后续开发者快速理解项目结构、代码职责、逻辑分层、业务链路和组件交互方式。

---

## 1. 项目总览

这是一个 Tauri + React + SQLite 的本地个人时间管理 Agent 项目。核心实体是：

- `Task`：用户想完成的任务，存在待办状态、优先级、截止时间、预计时长等信息。
- `TimeBlock`：时间轴上的一段安排，可绑定 Task，也可作为 event / break / routine 独立存在。
- `Heartbeat`：定时检查当前时间与 TimeBlock 状态，触发开始提醒、结束反馈和状态联动。
- `Agent`：通过 Chat 入口解析用户输入，生成动作计划，并且只能通过 Tool / Service 边界修改数据。

当前主架构：

```text
React UI
  -> Zustand Store
    -> Service Layer
      -> Repository Interface
        -> SQLite Repository
          -> tauri-plugin-sql
            -> SQLite local database

Chat UI
  -> chatStore
    -> AgentService
      -> AgentDomainRouter
        -> TimeManagementAgent / read-only handlers
          -> ActionPlanner / ToolRouter / ConfirmationService / ActionLogService
            -> Tool
              -> Service
                -> Repository
                  -> SQLite
```

---

## 2. 顶层目录结构

```text
time_manager/
├── src/                         # React + TypeScript 主业务代码
├── src-tauri/                   # Tauri Rust 壳与权限配置
├── docs/                        # 产品阶段文档、审计报告、路线重排
├── reports/                     # Agent V3-V5 mock-first 报告和验证指南
├── dist/                        # Vite 构建产物
├── node_modules/                # 前端依赖
├── package.json                 # npm/pnpm 脚本和依赖
├── vite.config.ts               # Vite 配置
├── tsconfig.json                # TypeScript 配置
├── index.html                   # Vite HTML 入口
├── .env / .env.example          # LLM 等环境变量
└── pnpm-lock.yaml               # pnpm 锁文件
```

---

## 3. 源码文件职责表

### 3.1 应用入口与壳层

| 文件 | 职责 |
|---|---|
| `src/main.tsx` | React 入口，把 `App` 挂载到 DOM，并引入全局 CSS。 |
| `src/App.tsx` | 应用根组件，启动时执行 `runMigrations()`；数据库 ready 后渲染 `AppLayout`。 |
| `src/index.css` | Tailwind CSS 入口和全局样式。 |
| `src/vite-env.d.ts` | Vite 环境变量类型声明。 |
| `src-tauri/src/main.rs` | Tauri native 入口，调用 Rust lib 的 `run()`。 |
| `src-tauri/src/lib.rs` | Tauri Builder 配置，注册 `tauri-plugin-sql`。 |
| `src-tauri/build.rs` | Tauri 构建脚本。 |
| `src-tauri/tauri.conf.json` | Tauri 应用配置。 |
| `src-tauri/capabilities/default.json` | Tauri 权限能力声明。 |
| `src-tauri/Cargo.toml` | Rust 依赖与包配置。 |

### 3.2 类型定义

| 文件 | 职责 |
|---|---|
| `src/types/task.types.ts` | `Task` 类型、Task 状态/优先级、创建/更新 Zod schema、TaskFilter。 |
| `src/types/timeblock.types.ts` | `TimeBlock` 类型、TimeBlock 状态/类型/source、执行反馈字段、创建/更新 Zod schema。 |
| `src/types/heartbeat.types.ts` | Heartbeat 设置、默认设置、`HeartbeatEvaluation` 结果结构。 |
| `src/types/agent.types.ts` | DB 持久化相关的 ActionLog、ConversationMessage、PendingConfirmation 类型和 schema。 |
| `src/agent/types.ts` | Agent 内部类型契约：Intent、ToolResult、AgentTrace、Domain、SemanticFrame、Plan、ConfirmationPolicy、PlanProposal。 |

### 3.3 数据库与 Migration

| 文件 | 职责 |
|---|---|
| `src/db/client.ts` | SQLite 单例连接，使用 `Database.load("sqlite:time_manager.db")`。 |
| `src/db/migrations.ts` | schema_version 驱动的 migration；创建 `tasks`、`time_blocks`、Agent 日志、会话、确认表，并扩展 Heartbeat 执行字段。 |

### 3.4 Repository Interface

| 文件 | 职责 |
|---|---|
| `src/repositories/interfaces/ITaskRepository.ts` | Task 数据访问接口。 |
| `src/repositories/interfaces/ITimeBlockRepository.ts` | TimeBlock 数据访问接口。 |
| `src/repositories/interfaces/IActionLogRepository.ts` | ActionLog 数据访问接口。 |
| `src/repositories/interfaces/IConfirmationRepository.ts` | PendingConfirmation 数据访问接口。 |
| `src/repositories/interfaces/IConversationRepository.ts` | ConversationMessage 数据访问接口。 |

### 3.5 SQLite Repository

| 文件 | 职责 |
|---|---|
| `src/repositories/sqlite/SqliteTaskRepository.ts` | Task CRUD SQL、软删除、行映射。 |
| `src/repositories/sqlite/SqliteTimeBlockRepository.ts` | TimeBlock CRUD SQL、按日期/任务查询、软删除、执行字段映射。 |
| `src/repositories/sqlite/SqliteActionLogRepository.ts` | `agent_action_logs` 的创建、查询、更新。 |
| `src/repositories/sqlite/SqliteConfirmationRepository.ts` | `pending_confirmations` 的创建、查询、状态更新、过期处理。 |
| `src/repositories/sqlite/SqliteConversationRepository.ts` | `conversation_messages` 的创建、历史查询、清空。 |

### 3.6 Service Layer

| 文件 | 职责 |
|---|---|
| `src/services/TaskService.ts` | Task 业务规则：创建、更新、状态更新、软删除；删除任务时联动软删除关联 TimeBlock。 |
| `src/services/TimeBlockService.ts` | TimeBlock 业务规则：创建、更新、状态更新、执行状态更新、软删除、按任务计数。 |
| `src/services/ScheduleService.ts` | 跨 Task/TimeBlock 的排期核心：冲突检查、Task 安排到 TimeBlock、TimeBlock 移回 Todo。 |
| `src/services/HeartbeatService.ts` | Heartbeat 纯评估与执行反馈逻辑：当前焦点、提醒、开始提示、结束反馈、Done/Skip/Delay 状态联动。 |
| `src/services/ActionLogService.ts` | Agent / Heartbeat / Timeline 操作日志的统一服务封装。 |
| `src/services/ConfirmationService.ts` | 危险操作确认记录的创建、确认、拒绝、过期处理。 |

### 3.7 Store Layer

| 文件 | 职责 |
|---|---|
| `src/store/uiStore.ts` | 全局 UI 状态：页面切换、TaskForm、ScheduleDialog、TimeBlockForm 开关和编辑 ID。 |
| `src/store/taskStore.ts` | Task 列表状态；调用 TaskService / ScheduleService；删除 Task 后刷新 Timeline。 |
| `src/store/timeBlockStore.ts` | TimeBlock 当前日期、加载、增删改、移回 Todo；Timeline 菜单 Done/Skip/Delay 联动和日志。 |
| `src/store/heartbeatStore.ts` | Heartbeat 设置持久化、定时 tick、运行态 blocks、反馈弹窗状态、Heartbeat 操作日志。 |
| `src/store/chatStore.ts` | Chat 消息状态、历史加载、发送消息、确认/拒绝 Agent 操作、根据 `refreshHints` 刷新 Task/Timeline。 |

### 3.8 页面与布局组件

| 文件 | 职责 |
|---|---|
| `src/components/layout/AppLayout.tsx` | 主布局，按 activePage 渲染页面，并挂载全局 Dialog 和 Toaster。 |
| `src/components/layout/Sidebar.tsx` | 左侧导航栏，切换 Today / Chat / Settings。 |
| `src/pages/TodayPage.tsx` | 今日主页面，组合 TodoList、HeartbeatPanel、TodayTimeline、反馈/延迟弹窗；管理 Heartbeat 生命周期。 |
| `src/pages/ChatPage.tsx` | Chat 页面壳，渲染 ChatPanel。 |
| `src/pages/SettingsPage.tsx` | Heartbeat 设置、数据库说明、版本信息。 |

### 3.9 Todo 组件

| 文件 | 职责 |
|---|---|
| `src/components/todo/TodoList.tsx` | Task 面板，加载任务、筛选任务、渲染 TodoItem、新建入口。 |
| `src/components/todo/TodoItem.tsx` | 单个 Task 展示；支持完成/重开、排期、编辑、删除确认。 |
| `src/components/todo/TodoForm.tsx` | 新建/编辑 Task 的全局 Dialog。 |
| `src/components/todo/TodoFilters.tsx` | Task 状态筛选按钮组。 |

### 3.10 Schedule / Timeline 组件

| 文件 | 职责 |
|---|---|
| `src/components/schedule/ScheduleTaskDialog.tsx` | 将 Task 安排到 TimeBlock 的 Dialog；实时冲突检查；成功后刷新 Task 和 Timeline。 |
| `src/components/timeline/TodayTimeline.tsx` | 当日 Timeline 容器，日期导航、当前时间线、渲染 TimeBlockCard。 |
| `src/components/timeline/TimeBlockCard.tsx` | 单个 TimeBlock 展示和菜单操作：完成、跳过、延迟、编辑、移回 Todo、删除。 |
| `src/components/timeline/TimeBlockForm.tsx` | 手工创建/编辑非 task 类型 TimeBlock；实时冲突检查。 |
| `src/components/timeline/TimeRuler.tsx` | Timeline 时间刻度尺。 |

### 3.11 Heartbeat 组件

| 文件 | 职责 |
|---|---|
| `src/components/heartbeat/HeartbeatPanel.tsx` | Heartbeat 状态面板，展示运行状态、当前焦点、即将开始提醒。 |
| `src/components/heartbeat/CurrentFocusCard.tsx` | 当前焦点 TimeBlock 操作卡：开始、完成、跳过、延迟。 |
| `src/components/heartbeat/ExecutionFeedbackDialog.tsx` | TimeBlock 结束后的反馈弹窗；支持完成、拆成剩余任务、延长当前任务、延迟、暂不处理。 |
| `src/components/heartbeat/DelayChoiceDialog.tsx` | 延迟选择弹窗：今天做则请求 Agent 推荐空闲时段，之后做则标记 delayed。 |

### 3.12 Chat 组件

| 文件 | 职责 |
|---|---|
| `src/components/chat/ChatPanel.tsx` | Chat 页面主体，加载历史、滚动到底部、渲染消息和输入框。 |
| `src/components/chat/ChatMessage.tsx` | 消息气泡，展示 AgentTrace dev 标签和 confirmation 确认/取消按钮。 |
| `src/components/chat/ChatInput.tsx` | 输入框，Enter 发送，调用 chatStore.sendMessage。 |

### 3.13 Shared 组件

| 文件 | 职责 |
|---|---|
| `src/components/shared/ConfirmDialog.tsx` | 通用确认弹窗。 |
| `src/components/shared/StatusBadge.tsx` | Task 状态、优先级、TimeBlock 状态、TimeBlock 类型点。 |
| `src/components/shared/PlanProposalCard.tsx` | 展示 Agent 生成的候选方案列表，供用户选择执行。 |

### 3.14 工具函数

| 文件 | 职责 |
|---|---|
| `src/lib/dateUtils.ts` | 时间格式化、时间段计算、Timeline 像素位置计算。 |
| `src/lib/conflictDetector.ts` | TimeBlock 时间冲突检测。 |
| `src/lib/scheduler.ts` | 规则排程算法：找空闲槽、任务排序、日程重排。 |
| `src/lib/utils.ts` | `cn()`，合并 Tailwind class。 |

### 3.15 Agent 主入口与路由

| 文件 | 职责 |
|---|---|
| `src/agent/AgentService.ts` | Agent 总协调器：注册 Tool、路由输入、处理 time-management、非时间 handler、确认/拒绝、PlanProposal 执行、经验记忆更新。 |
| `src/agent/router/AgentDomainRouter.ts` | 规则化 domain 分类：time_management、general_chat、knowledge_qa、writing_assistant、external_info、assistant_meta、feedback、low_signal。 |
| `src/agent/time-management/TimeManagementAgent.ts` | 时间管理 Agent 子系统：语义解析、动作规划、确认、ToolRouter 执行、推荐排程、trace 组装。 |
| `src/agent/IntentParser.ts` | 旧版正则 IntentParser，当前属于 legacy/deprecated 方向。 |
| `src/agent/ToolRouter.ts` | Tool 注册与统一执行，捕获异常并 normalize 为 AgentToolResult。 |
| `src/agent/tools/BaseTool.ts` | Tool 基类，提供统一 success/failure 和参数检查辅助。 |

### 3.16 Agent Handler

| 文件 | 职责 |
|---|---|
| `src/agent/handlers/AgentHandler.ts` | handler 接口。 |
| `src/agent/handlers/LLMDirectHandler.ts` | general / knowledge / writing 的只读响应路径，当前未真实调用 LLM。 |
| `src/agent/handlers/ExternalInfoHandler.ts` | 实时外部信息请求的无工具提示。 |
| `src/agent/handlers/MetaHandler.ts` | 助手身份/能力说明。 |
| `src/agent/handlers/FeedbackHandler.ts` | 用户反馈或抱怨的只读确认。 |
| `src/agent/handlers/LowSignalHandler.ts` | 低信息输入的引导回复。 |

### 3.17 Agent Experience

| 文件 | 职责 |
|---|---|
| `src/agent/experience/ConversationContextBuilder.ts` | 构建 Agent 上下文：当前时间、时区、页面、最近消息、短期记忆。 |
| `src/agent/experience/SemanticFrameParser.ts` | 时间管理语义解析：目标、时间表达式、时长、对象引用、日期范围等。 |
| `src/agent/experience/ActionPlanner.ts` | 从 SemanticFrame 生成 ExperienceActionPlan，决定 direct/tool/query/recommendation/batch/defer。 |
| `src/agent/experience/PlannerPort.ts` | Planner 抽象接口，便于测试注入 StubPlanner。 |
| `src/agent/experience/ResponseComposer.ts` | 根据上下文、语义、计划和工具结果生成用户可见回复。 |
| `src/agent/experience/ResponseBoundary.ts` | 统一响应出口，清理内部名、JSON 包装和不合适的技术词。 |
| `src/agent/experience/dateFormatting.ts` | Agent 回复用的时区时间格式化。 |

### 3.18 Agent Tool

| 文件 | 职责 |
|---|---|
| `src/agent/tools/task/createTaskTool.ts` | 创建 Task。 |
| `src/agent/tools/task/updateTaskTool.ts` | 更新 Task。 |
| `src/agent/tools/task/deleteTaskTool.ts` | 删除 Task，需确认。 |
| `src/agent/tools/task/listTasksTool.ts` | 查询 Task 列表。 |
| `src/agent/tools/task/markTaskCompletedTool.ts` | 标记 Task 完成。 |
| `src/agent/tools/timeblock/createTimeBlockTool.ts` | 创建 TimeBlock。 |
| `src/agent/tools/timeblock/updateTimeBlockTool.ts` | 更新 TimeBlock。 |
| `src/agent/tools/timeblock/deleteTimeBlockTool.ts` | 删除 TimeBlock，需确认。 |
| `src/agent/tools/timeblock/listTimeBlocksTool.ts` | 查询指定日期 TimeBlock。 |
| `src/agent/tools/timeblock/bindTaskToTimeBlockTool.ts` | 将已有 Task 绑定到 TimeBlock。 |
| `src/agent/tools/schedule/scheduleTaskTool.ts` | 创建或使用 Task 并安排到 TimeBlock。 |
| `src/agent/tools/schedule/detectConflictsTool.ts` | 检查时间冲突。 |
| `src/agent/tools/schedule/getFreeSlotsTool.ts` | 查询 08:00-22:00 空闲时间段。 |
| `src/agent/tools/schedule/getTodayPlanTool.ts` | 查询今日 TimeBlock 和未安排任务。 |
| `src/agent/tools/schedule/rescheduleDayTool.ts` | 对一天内可移动 TimeBlock 做规则重排，需确认。 |
| `src/agent/tools/explain/explainTaskTool.ts` | 解释某个 Task 的状态和时间块安排。 |
| `src/agent/tools/explain/explainScheduleTool.ts` | 解释某日排程统计和固定时间块。 |

### 3.19 Agent Scheduling / Recommendation / Memory

| 文件 | 职责 |
|---|---|
| `src/agent/time-management/scheduling/AvailabilityProvider.ts` | 按用户时区计算 08:00-22:00 可用时间窗。 |
| `src/agent/time-management/scheduling/SchedulingReasoner.ts` | 对空闲时间窗做简单排序，生成候选推荐。 |
| `src/agent/time-management/scheduling/RecommendationPlanner.ts` | 组合 AvailabilityProvider + SchedulingReasoner。 |
| `src/agent/time-management/RecommendationHandler.ts` | V5 建议型处理器，基于 mock memory/RAG 和日程密度生成 suggestion / confirmation_required / executable_action。 |
| `src/agent/memory/MemoryAdapter.ts` | 行为记忆接口。 |
| `src/agent/memory/MockMemoryAdapter.ts` | 进程内 mock 行为记忆。 |
| `src/agent/memory/RagAdapter.ts` | RAG 摘要检索接口。 |
| `src/agent/memory/MockRagAdapter.ts` | 固定摘要 mock RAG。 |
| `src/agent/notification/NotificationAdapter.ts` | 通知接口。 |
| `src/agent/notification/MockNotificationAdapter.ts` | 进程内 mock 通知队列。 |

### 3.20 LLM Experimental Path

| 文件 | 职责 |
|---|---|
| `src/agent/llm/LLMClient.ts` | LLM 客户端统一接口和错误类型。 |
| `src/agent/llm/DeepSeekClient.ts` | DeepSeek OpenAI-compatible API 客户端。 |
| `src/agent/llm/schemas.ts` | LLM 输出 schema 和 JSON 解析。 |
| `src/agent/llm/prompts.ts` | LLM system prompt 和上下文格式化。 |
| `src/agent/llm/contextBuilder.ts` | LLMPlanner 所需上下文构造。 |
| `src/agent/LLMPlanner.ts` | LLM 输出到 AgentActionPlan 的转换和安全校验。当前不在 `AgentService` 主路实例化。 |

### 3.21 测试与 Mock Harness

| 文件 | 职责 |
|---|---|
| `src/agent/testing/createMockAgentHarness.ts` | 创建 mock Agent 测试环境，注入内存 service/repo/adapter。 |
| `src/agent/testing/memoryServices.ts` | 内存版 Task / TimeBlock / Schedule / Confirmation / ActionLog。 |
| `src/agent/testing/mockInput.ts` | 测试断言辅助。 |
| `src/agent/testing/StubPlanner.ts` | 测试用 PlannerPort 实现。 |
| `src/agent/testing/__tests__/mock_smoke.test.ts` | mock harness 冒烟测试。 |
| `src/agent/__tests__/agent_router_gold.test.ts` | Agent router gold set，覆盖 8 domain 和关键 time-management 路径。 |
| `src/agent/__tests__/agent_v3_pipeline.test.ts` | Agent V3 防御/确认/PlannerPort 相关测试。 |
| `src/agent/__tests__/agent_v4_multiday.test.ts` | Agent V4 多日、batch、defer 测试。 |
| `src/agent/__tests__/agent_v5_recommendation.test.ts` | Agent V5 recommendation / memory / rag / notification 测试。 |
| `src/agent/experience/__tests__/response_boundary.test.ts` | ResponseBoundary 清理和兜底测试。 |
| `src/agent/experience/__tests__/v3_6_1_pipeline.test.ts` | V3.6.1 pipeline 基础闭环测试。 |

---

## 4. 整体逻辑分层

### 4.1 UI Layer

负责渲染、收集用户输入、调用 Store action。

代表文件：

- `components/**`
- `pages/**`
- `AppLayout`

原则：

- UI 不直接写 SQL。
- 大多数 UI 通过 Store 调用 Service。
- 个别复杂弹窗如 `ExecutionFeedbackDialog` / `DelayChoiceDialog` 直接 new `AgentService` 来生成/执行方案，这是当前的特殊路径。

### 4.2 Store Layer

负责前端状态、加载数据、刷新视图、桥接 UI 和 Service。

代表文件：

- `taskStore`
- `timeBlockStore`
- `heartbeatStore`
- `chatStore`
- `uiStore`

特点：

- `taskStore` 管 Task 列表。
- `timeBlockStore` 管当前日期和 Timeline blocks。
- `heartbeatStore` 管定时器、反馈弹窗、Heartbeat 设置。
- `chatStore` 管 Chat 历史和 Agent 调用。

### 4.3 Service Layer

负责业务规则，屏蔽 Repository 实现。

代表文件：

- `TaskService`
- `TimeBlockService`
- `ScheduleService`
- `HeartbeatService`
- `ActionLogService`
- `ConfirmationService`

这是业务稳定性的核心层。

### 4.4 Repository Layer

负责 SQL 和行映射。

代表文件：

- `SqliteTaskRepository`
- `SqliteTimeBlockRepository`
- `SqliteActionLogRepository`
- `SqliteConfirmationRepository`
- `SqliteConversationRepository`

### 4.5 Agent Layer

负责自然语言输入到工具执行的编排。

核心流程：

```text
AgentService.processInput
  -> ConversationContextBuilder
  -> AgentDomainRouter
  -> time_management ? TimeManagementAgent : read-only handler
  -> ResponseBoundary
  -> ActionLog / Trace / refreshHints
```

时间管理写操作：

```text
TimeManagementAgent
  -> SemanticFrameParser
  -> PlannerPort(ActionPlanner)
  -> ConfirmationService or ToolRouter
  -> Tool
  -> Service
  -> Repository
```

---

## 5. 核心逻辑链路

### 5.1 应用启动链路

```text
main.tsx
  -> <App />
  -> runMigrations()
  -> db ready
  -> <AppLayout />
  -> Sidebar + active page + global dialogs
```

失败时 `App` 显示数据库初始化错误页。

### 5.2 Task 新建链路

```text
TodoList 点击“新建”
  -> uiStore.openTaskForm()
  -> TodoForm 打开
  -> submit
  -> taskStore.addTask()
  -> TaskService.createTask()
  -> SqliteTaskRepository.create()
  -> SQLite tasks
  -> taskStore 更新 tasks
```

### 5.3 Task 删除链路

```text
TodoItem 点击删除
  -> ConfirmDialog
  -> taskStore.deleteTask()
  -> TaskService.deleteTask()
    -> find task
    -> find related TimeBlocks
    -> softDelete related TimeBlocks
    -> softDelete Task
  -> taskStore 移除任务
  -> timeBlockStore.refreshBlocks()
```

### 5.4 Task 安排到 Timeline 链路

```text
TodoItem 点击“安排到日程”
  -> uiStore.openScheduleDialog(taskId, title)
  -> ScheduleTaskDialog
  -> ScheduleService.checkConflicts() 实时检查
  -> submit
  -> ScheduleService.scheduleTaskToTimeBlock()
    -> validate task
    -> check time
    -> check conflicts
    -> create TimeBlock(type=task)
    -> update Task status=scheduled
  -> loadTasks() + refreshBlocks()
```

### 5.5 手工创建 TimeBlock 链路

```text
TodayTimeline 点击“添加”
  -> uiStore.openTimeBlockForm()
  -> TimeBlockForm
  -> ScheduleService.checkConflicts() 实时检查
  -> timeBlockStore.addBlock()
  -> TimeBlockService.createTimeBlock()
  -> SqliteTimeBlockRepository.create()
```

手工创建表单只允许 `event / break / routine`，不允许直接创建 `task` 类型块。

### 5.6 TimeBlock 移回 Todo 链路

```text
TimeBlockCard 点击“移回 Todo”
  -> ConfirmDialog
  -> timeBlockStore.moveBackToTask()
  -> ScheduleService.moveTimeBlockBackToTask()
    -> 校验 task_id / type / status
    -> softDelete TimeBlock
    -> countActiveByTaskId
    -> Task status = todo 或 scheduled
  -> loadTasks()
```

### 5.7 Heartbeat tick 链路

```text
TodayPage useEffect
  -> heartbeatEnabled ? heartbeatStore.startHeartbeat()
  -> setInterval(tick)

heartbeatStore.tick()
  -> TimeBlockService.getBlocksForDate(today)
  -> HeartbeatService.evaluateNow(blocks, now, settings)
  -> 更新 currentFocus / upcomingReminder / startPrompt / pendingFeedback
  -> markReminderSent / markStartPromptSent
  -> 必要时打开 ExecutionFeedbackDialog
```

### 5.8 Heartbeat 完成/跳过/延迟链路

```text
CurrentFocusCard 或 ExecutionFeedbackDialog
  -> heartbeatStore.completeBlock / skipBlock / delayBlock
  -> HeartbeatService.completeBlock / skipBlock / delayBlock
    -> TimeBlockService.updateExecutionState()
    -> TaskService.getFutureActiveBlocksCount()
    -> TaskService.updateTaskStatus()
  -> logHeartbeatAction()
  -> refreshBlocks() + loadTasks()
```

### 5.9 Timeline 菜单 Done/Skip/Delay 链路

```text
TimeBlockCard 菜单
  -> timeBlockStore.completeBlockWithLinkage / skipBlockWithLinkage / delay dialog
  -> HeartbeatService 状态联动
  -> logTimelineAction()
  -> loadTasks()
```

Timeline 菜单复用了 HeartbeatService 的状态联动规则，避免出现 Timeline 和 Heartbeat 行为不一致。

### 5.10 Chat Agent 普通消息链路

```text
ChatInput
  -> chatStore.sendMessage(content)
  -> conversationRepo.create(user)
  -> AgentService.processInput(content, context)
    -> build context
    -> AgentDomainRouter.classify()
    -> time_management or read-only handler
    -> ResponseBoundary.finalize()
    -> ActionLog / metadata / trace
  -> conversationRepo.create(assistant)
  -> applyRefreshHints()
```

### 5.11 Agent time-management 写操作链路

```text
AgentService.processInput()
  -> TimeManagementAgent.handle()
    -> SemanticFrameParser.parse()
    -> ActionPlanner.plan()
    -> if actionPlan.requiresConfirmation or tool.requiresConfirmation
         ConfirmationService.createConfirmation()
         return confirmationId
       else
         ActionLogService.logToolExecution()
         ToolRouter.execute()
         Tool.execute()
         Service
         Repository
    -> ResponseBoundary.finalize()
```

### 5.12 Agent confirmation 链路

```text
ChatMessage 确认执行
  -> chatStore.confirmAction(confirmationId)
  -> AgentService.confirmAction()
    -> ConfirmationService.getById()
    -> ConfirmationService.confirm()
    -> ActionLogService.logRequest()
    -> ActionLogService.logToolExecution()
    -> ToolRouter.execute(confirmation.tool_name, args)
    -> logSuccess / logFailure
    -> refreshHints
  -> chatStore 保存 assistant message
  -> applyRefreshHints()
```

拒绝链路类似，但不执行 Tool，只写 cancelled log。

### 5.13 Delay / Feedback 的 PlanProposal 链路

```text
DelayChoiceDialog “今天做”
  -> AgentService.proposeReschedule(block)
  -> ToolRouter.execute("get_free_slots")
  -> 返回 PlanProposal options
  -> 用户选择 option
  -> AgentService.executePlanOption(option)
    -> precheck conflict
    -> ToolRouter.execute(option.toolName)
    -> logProposalEvent()
```

```text
ExecutionFeedbackDialog “拆成剩余任务 / 延长当前任务”
  -> AgentService.proposeEndFeedback(block, mode)
  -> 返回 PlanProposal
  -> executePlanOption()
  -> create_task 或 update_time_block
  -> refreshBlocks + loadTasks
```

### 5.14 V5 Recommendation mock 链路

当前主要在测试中使用：

```text
RecommendationHandler.generateRecommendation(context, todayBlocks)
  -> detectScheduleDensity()
  -> MemoryAdapter.getRecentBehavior()
  -> RagAdapter.retrieveRelatedHistory()
  -> 返回 suggestion / confirmation_required / executable_action
```

`AgentService.updateExperienceMemory()` 会在 `schedule_task` 成功后写 `MemoryAdapter.recordSchedule()`，提醒创建成功后调用 `NotificationAdapter.notify()`。

---

## 6. 组件交互结构

### 6.1 AppLayout 组件树

```text
App
└── AppLayout
    ├── Sidebar
    ├── TodayPage | ChatPage | SettingsPage
    ├── TodoForm              # 全局 task dialog
    ├── ScheduleTaskDialog    # 全局 schedule dialog
    ├── TimeBlockForm         # 全局 timeblock dialog
    └── Toaster
```

`uiStore.activePage` 决定中间主页面。

### 6.2 TodayPage 组件树

```text
TodayPage
├── TodoList
│   ├── TodoFilters
│   └── TodoItem[]
├── HeartbeatPanel
│   └── CurrentFocusCard
├── TodayTimeline
│   ├── TimeRuler
│   └── TimeBlockCard[]
├── ExecutionFeedbackDialog
└── DelayChoiceDialog
```

交互关系：

- TodoList 负责 Task 入口。
- TodayTimeline 负责 TimeBlock 展示。
- HeartbeatPanel 负责当前执行态。
- ExecutionFeedbackDialog 和 DelayChoiceDialog 横跨 Heartbeat 与 Timeline，执行后同时刷新 Task 和 TimeBlock。

### 6.3 Todo 组件交互

```text
TodoList
  -> useTaskStore.loadTasks()
  -> filter local tasks
  -> TodoItem

TodoItem
  -> openTaskForm(task.id)
  -> openScheduleDialog(task.id, task.title)
  -> taskStore.updateTask(status)
  -> taskStore.deleteTask()
```

`TodoForm` 不嵌在 TodoList 内，而是 AppLayout 全局挂载；由 `uiStore.taskFormOpen` 控制。

### 6.4 Timeline 组件交互

```text
TodayTimeline
  -> useTimeBlockStore.blocks/currentDate
  -> setCurrentDate(prev/next/today)
  -> openTimeBlockForm()
  -> TimeBlockCard[]

TimeBlockCard
  -> timeBlockStore.completeBlockWithLinkage()
  -> timeBlockStore.skipBlockWithLinkage()
  -> heartbeatStore.openDelayDialog()
  -> openTimeBlockForm(block.id)
  -> timeBlockStore.moveBackToTask()
  -> timeBlockStore.deleteBlock()
```

Timeline 的状态变化会影响 Todo，因为 Task 状态可能被联动更新，所以相关操作后会调用 `loadTasks()`。

### 6.5 Heartbeat 组件交互

```text
HeartbeatPanel
  -> heartbeatStore currentFocus/upcomingReminder/startPrompt
  -> CurrentFocusCard

CurrentFocusCard
  -> heartbeatStore.startBlock()
  -> heartbeatStore.completeBlock()
  -> heartbeatStore.skipBlock()
  -> heartbeatStore.openDelayDialog()
  -> refreshBlocks()
  -> loadTasks()

ExecutionFeedbackDialog
  -> heartbeatStore.completeBlock()
  -> heartbeatStore.skipBlock()
  -> heartbeatStore.openDelayDialog()
  -> AgentService.proposeEndFeedback()
  -> AgentService.executePlanOption()
```

Heartbeat 不是 Agent 大脑，它只触发当前该处理的 TimeBlock，并把反馈动作交给 Service。

### 6.6 Chat 组件交互

```text
ChatPanel
  -> chatStore.loadHistory()
  -> ChatMessage[]
  -> ChatInput

ChatInput
  -> chatStore.sendMessage()

ChatMessage
  -> chatStore.confirmAction()
  -> chatStore.rejectAction()
```

Chat 成功执行 Agent 写操作后，`chatStore.applyRefreshHints()` 会刷新 Task 和 Timeline。

### 6.7 Shared 组件交互

- `ConfirmDialog` 被 TodoItem、TimeBlockCard 复用。
- `StatusBadge` 被 TodoItem、TimeBlockCard 复用。
- `PlanProposalCard` 被 ExecutionFeedbackDialog 和 DelayChoiceDialog 复用。

---

## 7. 当前关键边界

### 7.1 数据写入边界

```text
UI -> Store -> Service -> Repository -> SQLite
Agent -> ToolRouter -> Tool -> Service -> Repository -> SQLite
```

Agent 的写操作基本遵守 Tool 边界。

### 7.2 日志边界

```text
AgentService / heartbeatStore / timeBlockStore
  -> ActionLogService
  -> SqliteActionLogRepository
  -> agent_action_logs
```

Chat Agent、Heartbeat、Timeline 菜单操作都能留下日志。

### 7.3 确认边界

```text
dangerous plan/tool
  -> ConfirmationService.createConfirmation()
  -> ChatMessage confirmation buttons
  -> AgentService.confirmAction()
  -> ToolRouter.execute()
```

当前删除和重排类工具已有确认；`batch_action` / `defer_task` 还需要进一步闭环。

### 7.4 Agent 只读 handler 边界

非时间管理输入会走 handler：

- `LLMDirectHandler`
- `ExternalInfoHandler`
- `MetaHandler`
- `FeedbackHandler`
- `LowSignalHandler`

这些 handler 当前不注入 Service / ToolRouter，不写库。

---

## 8. 重要注意点

1. `LLMPlanner` / `DeepSeekClient` 存在，但当前不在 `AgentService` 主路实例化。
2. `chatStore` 直接使用 `SqliteConversationRepository`，后续建议补 `ConversationService`。
3. `ExecutionFeedbackDialog` 和 `DelayChoiceDialog` 直接 new `AgentService`，属于 UI 复杂流程中的特殊路径。
4. `ActionPlanner` 和 `TimeManagementAgent` 有少量直接 Service 读操作，写操作仍走 Tool。
5. `RecommendationHandler` 当前主要是 V5 mock-first 能力，尚未完整接入产品主路径。
6. `IntentParser.ts` 是旧规则解析遗留代码，当前主链路已经迁移到 DomainRouter + SemanticFrameParser。

---

## 9. 推荐阅读顺序

如果新开发者第一次读项目，建议按这个顺序：

1. `src/types/task.types.ts`
2. `src/types/timeblock.types.ts`
3. `src/db/migrations.ts`
4. `src/services/TaskService.ts`
5. `src/services/TimeBlockService.ts`
6. `src/services/ScheduleService.ts`
7. `src/store/taskStore.ts`
8. `src/store/timeBlockStore.ts`
9. `src/pages/TodayPage.tsx`
10. `src/components/todo/TodoList.tsx`
11. `src/components/timeline/TodayTimeline.tsx`
12. `src/services/HeartbeatService.ts`
13. `src/store/heartbeatStore.ts`
14. `src/agent/AgentService.ts`
15. `src/agent/time-management/TimeManagementAgent.ts`
16. `src/agent/experience/SemanticFrameParser.ts`
17. `src/agent/experience/ActionPlanner.ts`
18. `src/agent/ToolRouter.ts`
19. `src/agent/tools/**`

---

## 10. 一句话架构总结

这个项目的核心不是 Todo List，而是：

> **以 Task / TimeBlock / Timeline 为数据核心，以 Heartbeat 为执行触发器，以 Agent + Tool Contract 为计划编排入口的本地时间管理系统。**

