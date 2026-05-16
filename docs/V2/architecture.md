# Time Manager V2 — 代码结构说明

> 文档版本：1.0  
> 生成日期：2026-05-16  
> 项目版本：V2（Heartbeat 和执行反馈）

---

## 1. 物理目录树

```
time_manager/
├── docs/                                   # 项目文档
│   ├── v0-closure-report.md               # V0 封板报告
│   ├── v1-closure-report.md               # V1 封板报告
│   ├── V1/
│   │   └── architecture.md               # V1 架构说明（历史文档）
│   └── V2/
│       ├── architecture.md               # 本文件：V2 代码结构说明
│       └── v2-closure-report.md          # V2 封板候选报告
│
├── src/                                    # 前端 + 业务逻辑（TypeScript）
│   ├── agent/                             # V1 Agent 系统（V2 未修改）
│   │   ├── tools/                         # Agent 工具集（17 个工具）
│   │   │   ├── BaseTool.ts               # Tool 抽象基类
│   │   │   ├── task/                     # 任务相关 Tools（5 个）
│   │   │   │   ├── createTaskTool.ts
│   │   │   │   ├── updateTaskTool.ts
│   │   │   │   ├── deleteTaskTool.ts
│   │   │   │   ├── listTasksTool.ts
│   │   │   │   └── markTaskCompletedTool.ts
│   │   │   ├── timeblock/               # 时间块相关 Tools（5 个）
│   │   │   │   ├── createTimeBlockTool.ts
│   │   │   │   ├── updateTimeBlockTool.ts
│   │   │   │   ├── deleteTimeBlockTool.ts
│   │   │   │   ├── listTimeBlocksTool.ts
│   │   │   │   └── bindTaskToTimeBlockTool.ts
│   │   │   ├── schedule/                # 排程相关 Tools（5 个）
│   │   │   │   ├── scheduleTaskTool.ts
│   │   │   │   ├── rescheduleDayTool.ts
│   │   │   │   ├── detectConflictsTool.ts
│   │   │   │   ├── getFreeSlotsTool.ts
│   │   │   │   └── getTodayPlanTool.ts
│   │   │   └── explain/                 # 解释型 Tools（2 个）
│   │   │       ├── explainTaskTool.ts
│   │   │       └── explainScheduleTool.ts
│   │   ├── AgentService.ts              # Agent 总协调器
│   │   ├── IntentParser.ts              # 自然语言意图解析（规则化）
│   │   ├── ToolRouter.ts               # 工具注册表与路由
│   │   └── types.ts                    # Agent 内部类型
│   │
│   ├── components/                        # React UI 组件
│   │   ├── chat/                         # Chat 界面组件
│   │   │   ├── ChatPanel.tsx            # Chat 主面板（消息列表 + 输入框）
│   │   │   ├── ChatMessage.tsx          # 单条消息气泡（含确认按钮）
│   │   │   └── ChatInput.tsx            # 消息输入框
│   │   ├── heartbeat/                   # V2 新增：Heartbeat 执行反馈组件
│   │   │   ├── HeartbeatPanel.tsx       # Heartbeat 状态面板（嵌入 TodayPage）
│   │   │   ├── CurrentFocusCard.tsx     # 当前进行中 TimeBlock 卡片
│   │   │   └── ExecutionFeedbackDialog.tsx  # 结束反馈对话框（Done/Skip/Delay）
│   │   ├── layout/                      # 布局组件
│   │   │   ├── AppLayout.tsx           # 应用主布局（侧边栏 + 内容区）
│   │   │   └── Sidebar.tsx             # 侧边栏导航（今日/助手/设置）
│   │   ├── schedule/                    # 排期对话框
│   │   │   └── ScheduleTaskDialog.tsx  # 为任务选择时间并排期
│   │   ├── shared/                      # 通用组件
│   │   │   ├── ConfirmDialog.tsx        # 通用确认对话框
│   │   │   └── StatusBadge.tsx         # 状态/优先级标签（V2 新增 delayed 配置）
│   │   ├── timeline/                    # 时间轴组件
│   │   │   ├── TodayTimeline.tsx       # 今日时间轴容器（时间刻度 + 时间块）
│   │   │   ├── TimeBlockCard.tsx       # 时间块卡片（V2 新增 delayed/in_progress 样式）
│   │   │   ├── TimeBlockForm.tsx       # 时间块创建/编辑表单
│   │   │   └── TimeRuler.tsx           # 时间刻度尺（24h）
│   │   └── todo/                        # 任务列表组件
│   │       ├── TodoList.tsx            # 任务列表容器
│   │       ├── TodoItem.tsx            # 单条任务项
│   │       ├── TodoForm.tsx            # 任务创建/编辑表单
│   │       └── TodoFilters.tsx         # 任务过滤器
│   │
│   ├── db/                               # 数据库层
│   │   ├── client.ts                    # SQLite 连接单例管理
│   │   └── migrations.ts               # Schema 版本迁移（v1~v4）
│   │
│   ├── lib/                              # 公共工具库
│   │   ├── conflictDetector.ts         # 时间冲突检测算法
│   │   ├── dateUtils.ts                # 日期时间工具函数
│   │   ├── scheduler.ts                # 排程算法（空闲槽查找/全天重排）
│   │   └── utils.ts                    # 通用工具（cn 类名合并等）
│   │
│   ├── pages/                            # 页面级组件
│   │   ├── TodayPage.tsx               # 今日视图（V2 接入 Heartbeat）
│   │   ├── ChatPage.tsx                # Agent Chat 页面
│   │   └── SettingsPage.tsx            # 设置页面（V2 新增 Heartbeat 配置区）
│   │
│   ├── repositories/                     # 数据访问层
│   │   ├── interfaces/                  # Repository 接口定义
│   │   │   ├── ITaskRepository.ts
│   │   │   ├── ITimeBlockRepository.ts
│   │   │   ├── IActionLogRepository.ts
│   │   │   ├── IConversationRepository.ts
│   │   │   └── IConfirmationRepository.ts
│   │   └── sqlite/                      # SQLite 实现
│   │       ├── SqliteTaskRepository.ts
│   │       ├── SqliteTimeBlockRepository.ts  # V2 更新：新增字段映射
│   │       ├── SqliteActionLogRepository.ts
│   │       ├── SqliteConversationRepository.ts
│   │       └── SqliteConfirmationRepository.ts
│   │
│   ├── services/                         # 业务逻辑层（Service Layer）
│   │   ├── TaskService.ts              # Task 业务逻辑（V2 新增 getFutureActiveBlocksCount）
│   │   ├── TimeBlockService.ts         # TimeBlock 业务逻辑（V2 新增 updateExecutionState）
│   │   ├── HeartbeatService.ts         # V2 新增：Heartbeat 核心业务逻辑
│   │   ├── ScheduleService.ts          # 排程业务逻辑
│   │   ├── ActionLogService.ts         # Agent 操作日志服务
│   │   └── ConfirmationService.ts      # 危险操作确认机制
│   │
│   ├── store/                            # Zustand 状态管理
│   │   ├── taskStore.ts                # Task 状态管理
│   │   ├── timeBlockStore.ts           # TimeBlock 状态管理
│   │   ├── heartbeatStore.ts           # V2 新增：Heartbeat 状态（含 persist 设置）
│   │   ├── chatStore.ts                # Chat 消息状态管理
│   │   └── uiStore.ts                  # UI 状态管理（活跃页面、选中日期等）
│   │
│   ├── types/                            # 全局类型定义
│   │   ├── task.types.ts               # Task 实体 + Zod schema
│   │   ├── timeblock.types.ts          # TimeBlock 实体 + Zod schema（V2 扩展）
│   │   └── heartbeat.types.ts          # V2 新增：Heartbeat 配置和评估结果类型
│   │
│   ├── App.tsx                          # 根组件（AppLayout + Toast Provider）
│   ├── main.tsx                         # React 应用入口（挂载 + 数据库初始化）
│   └── index.css                        # 全局样式（Tailwind 导入）
│
├── src-tauri/                            # Rust 后端（Tauri）
│   ├── src/
│   │   ├── main.rs                     # Tauri 应用入口
│   │   └── lib.rs                      # 注册 tauri-plugin-sql（SQLite）
│   ├── capabilities/
│   │   └── default.json               # Tauri 权限配置
│   ├── Cargo.toml                      # Rust 依赖声明
│   ├── Cargo.lock                      # Rust 依赖锁定
│   ├── tauri.conf.json                 # Tauri 应用配置
│   └── build.rs                        # Rust 构建脚本
│
├── index.html                           # HTML 入口
├── package.json                         # Node.js 项目配置
├── pnpm-workspace.yaml                  # pnpm workspace 配置
├── tsconfig.json                        # TypeScript 编译器配置
├── vite.config.ts                       # Vite 构建配置
├── README.md                            # 项目说明
└── .npmrc                               # npm/pnpm 配置
```

---

## 2. 逻辑分层架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Tauri Desktop Shell                               │
│                   (Rust: 窗口管理 + SQLite 插件注册)                         │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ WebView
┌─────────────────────────────▼───────────────────────────────────────────────┐
│                          UI Layer (React Pages + Components)                │
│                                                                             │
│  ┌────────────┐  ┌──────────┐  ┌────────────┐   ┌────────────────────┐    │
│  │ TodayPage  │  │ ChatPage │  │SettingsPage│   │  Layout / Sidebar  │    │
│  │ + Heartbeat│  │          │  │+ Heartbeat │   │                    │    │
│  │   Panel    │  │          │  │  Settings  │   │                    │    │
│  └─────┬──────┘  └────┬─────┘  └─────┬──────┘   └────────────────────┘    │
│        │              │              │                                      │
└────────┼──────────────┼──────────────┼──────────────────────────────────────┘
         │              │              │
┌────────▼──────────────▼──────────────▼──────────────────────────────────────┐
│                       State Layer (Zustand Stores)                          │
│                                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────┐  ┌───────┐  │
│  │taskStore │  │timeBlockStore│  │heartbeatStore│  │chatSt. │  │uiSt.  │  │
│  │          │  │              │  │(V2新增,persist│  │        │  │       │  │
│  └────┬─────┘  └──────┬───────┘  │ 设置到localStorage)│      │  │       │  │
│       │               │          └──────┬───────┘  └───┬────┘  └───────┘  │
│       │               │                 │              │                    │
└───────┼───────────────┼─────────────────┼──────────────┼────────────────────┘
        │               │                 │              │
        │               │                 ▼              ▼
        │               │   ┌─────────────────────────────────────────┐
        │               │   │           Agent System (V1)             │
        │               │   │  AgentService → IntentParser            │
        │               │   │           → ToolRouter → 17 Tools       │
        │               │   │           → ActionLogService            │
        │               │   │           → ConfirmationService         │
        │               │   └──────────────┬──────────────────────────┘
        │               │                  │
        ▼               ▼                  ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                        Service Layer (业务规则中心)                            │
│                                                                               │
│  ┌─────────────┐  ┌──────────────────┐  ┌──────────────────┐                │
│  │ TaskService │  │TimeBlockService  │  │HeartbeatService  │  ...           │
│  │+getFuture   │  │+updateExecution  │  │(V2新增)          │                │
│  │ ActiveBlocks│  │  State           │  │纯逻辑评估 + DB操作│                │
│  └──────┬──────┘  └────────┬─────────┘  └────────┬─────────┘                │
│         │                  │                      │                          │
└─────────┼──────────────────┼──────────────────────┼──────────────────────────┘
          │                  │                      │
          ▼                  ▼                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                      Repository Layer (数据访问)                               │
│  ITaskRepository / ITimeBlockRepository / IActionLog... (接口)                │
│  SqliteTaskRepository / SqliteTimeBlockRepository(V2更新) / ...  (实现)       │
└──────────────────────────────────────┬────────────────────────────────────────┘
                                       │
                                       ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                         SQLite Database (本地文件)                             │
│                                                                               │
│  tasks | time_blocks(V2扩展) | agent_action_logs |                           │
│  conversation_messages | pending_confirmations | schema_version              │
│                                                                               │
│  通过 @tauri-apps/plugin-sql (Tauri IPC → Rust SQLite 驱动) 访问             │
└───────────────────────────────────────────────────────────────────────────────┘
```

**数据流路径说明：**

| 路径 | 触发 | 调用链 |
|---|---|---|
| V0 直接操作 | 用户点击 UI | Store → Service → Repository → SQLite |
| V1 Chat | 用户输入 Chat | chatStore → AgentService → IntentParser → ToolRouter → Tool → Service → Repository |
| V2 Heartbeat | 定时 tick | heartbeatStore → HeartbeatService → TimeBlockService/TaskService → Repository → SQLite |

---

## 3. 各文件详细说明

### 3.1 `src/types/` — 全局类型定义

| 文件 | 说明 |
|---|---|
| `task.types.ts` | Task 实体接口（`Task`）、状态枚举（`TaskStatus`）、优先级枚举（`TaskPriority`）、创建/更新 Zod schema |
| `timeblock.types.ts` | TimeBlock 实体接口（`TimeBlock`）、类型/状态/来源枚举、创建/更新 Zod schema。**V2 新增**：`TimeBlockStatus` 中加入 `"delayed"`；`TimeBlock` 接口新增 8 个可选执行时间戳字段（`reminder_sent_at`、`start_prompt_sent_at`、`end_prompt_sent_at`、`started_at`、`completed_at`、`skipped_at`、`delayed_at`、`feedback_note`）；`UpdateTimeBlockSchema` 对应扩展 |
| `heartbeat.types.ts` | **V2 新增**。`HeartbeatSettings`（配置结构：enabled/reminderMinutes/interval/autoFeedback）、`DEFAULT_HEARTBEAT_SETTINGS`（默认值）、`HeartbeatEvaluation`（evaluateNow 返回值：4 个事件槽） |

### 3.2 `src/db/` — 数据库层

| 文件 | 说明 |
|---|---|
| `client.ts` | SQLite 连接单例管理，提供 `getDb()` 获取数据库实例。基于 `@tauri-apps/plugin-sql` |
| `migrations.ts` | Schema 版本迁移定义，顺序执行，已应用版本不重复执行。共 4 个版本：**v1** 创建 tasks 表；**v2** 创建 time_blocks 表（含旧 CHECK 约束）+ 索引；**v3** 创建 agent_action_logs / conversation_messages / pending_confirmations 三张 Agent 表；**V2 新增 v4** 重建 time_blocks 表（PRAGMA foreign_keys OFF/ON 包裹，扩展 status CHECK 支持 `delayed`，新增 8 个执行时间戳字段，旧数据完整迁移） |

### 3.3 `src/repositories/` — 数据访问层

#### 接口层 `interfaces/`

| 文件 | 说明 |
|---|---|
| `ITaskRepository.ts` | Task 数据访问接口：CRUD + 按状态/优先级过滤查询 + 软删除 |
| `ITimeBlockRepository.ts` | TimeBlock 数据访问接口：按日期范围/任务 ID/主键查询 + CRUD + 软删除 + 活跃数量统计 |
| `IActionLogRepository.ts` | Agent 操作日志数据访问接口 |
| `IConversationRepository.ts` | 对话消息数据访问接口 |
| `IConfirmationRepository.ts` | 待确认操作数据访问接口 |

#### SQLite 实现层 `sqlite/`

| 文件 | 说明 |
|---|---|
| `SqliteTaskRepository.ts` | `ITaskRepository` 的 SQLite 实现。`findAll` 支持多种过滤条件，软删除过滤，状态/优先级 IN 查询 |
| `SqliteTimeBlockRepository.ts` | `ITimeBlockRepository` 的 SQLite 实现。**V2 更新**：`rowToTimeBlock` 映射器新增 8 个执行时间戳字段；`update` 方法新增对这 8 个字段的动态字段构建处理 |
| `SqliteActionLogRepository.ts` | `IActionLogRepository` 的 SQLite 实现 |
| `SqliteConversationRepository.ts` | `IConversationRepository` 的 SQLite 实现 |
| `SqliteConfirmationRepository.ts` | `IConfirmationRepository` 的 SQLite 实现 |

### 3.4 `src/services/` — 业务逻辑层

| 文件 | 说明 |
|---|---|
| `TaskService.ts` | Task 业务规则：Zod 输入校验、创建/更新/删除任务、状态流转、软删除联动关联 TimeBlock。**V2 新增** `getFutureActiveBlocksCount(taskId, afterTime)` — 统计某 Task 在指定时间后还有多少活跃未来 TimeBlock，供 HeartbeatService 判断 Task 联动状态 |
| `TimeBlockService.ts` | TimeBlock 业务规则：Zod 校验、创建/更新/删除、锁定守卫、冲突检测调用。**V2 新增** `updateExecutionState(id, update)` — 专供 HeartbeatService 调用的执行状态更新方法，可穿透 `is_locked` 守卫，只接受执行相关字段 |
| `HeartbeatService.ts` | **V2 新增**。Heartbeat 核心业务逻辑，分两层：**纯逻辑评估层**（同步，不访问 DB）：`evaluateNow` 综合评估、`getCurrentFocus` 当前焦点块、`getUpcomingReminder` 开始前提醒、`getStartPrompt` 开始提示、`getPendingFeedback` 待反馈块；**DB 操作层**（异步，注入 Service）：`markReminderSent/markStartPromptSent/markEndPromptSent` 防重复时间戳写入，`startBlock/completeBlock/skipBlock/delayBlock` 状态转换 + Task 联动 |
| `ScheduleService.ts` | 排程业务：为任务分配时间块、冲突检测、将时间块移回待办（Task 状态回退） |
| `ActionLogService.ts` | Agent 操作日志：记录 pending/executing/success/failed/cancelled 各阶段状态 |
| `ConfirmationService.ts` | 危险操作确认机制：创建待确认、确认/拒绝/过期处理 |

### 3.5 `src/store/` — Zustand 状态管理

| 文件 | 说明 |
|---|---|
| `taskStore.ts` | Task 全局状态：tasks 列表、isLoading/error、loadTasks/addTask/updateTask/deleteTask/scheduleTask |
| `timeBlockStore.ts` | TimeBlock 全局状态：blocks 列表、currentDate、loadBlocksForDate/addBlock/updateBlock/deleteBlock/updateBlockStatus/moveBackToTask/refreshBlocks |
| `heartbeatStore.ts` | **V2 新增**。Heartbeat 状态管理器。使用 Zustand `persist` middleware，将设置字段（heartbeatEnabled/reminderBeforeMinutes/heartbeatIntervalSeconds/autoFeedbackPromptEnabled）持久化到 `localStorage["heartbeat-settings"]`；运行时状态（currentFocusBlock/upcomingReminderBlock/startPromptBlock/pendingFeedbackBlock/isFeedbackDialogOpen/lastTickAt/\_intervalId）不持久化。核心 actions：`startHeartbeat`（防重复 interval）、`stopHeartbeat`（clearInterval + 清空状态）、`tick`（主检查循环）、`startBlock/completeBlock/skipBlock/delayBlock` |
| `chatStore.ts` | Chat 状态管理：消息列表、发送消息（调用 AgentService）、确认操作、加载历史、清空 |
| `uiStore.ts` | UI 状态管理：activePage（today/chat/settings）、选中日期、时间块表单开关状态 |

### 3.6 `src/components/` — UI 组件

#### `heartbeat/`（V2 新增）

| 文件 | 说明 |
|---|---|
| `HeartbeatPanel.tsx` | Heartbeat 状态面板，嵌入 TodayPage 的 Timeline 列上方。Heartbeat 关闭时仅显示最小化开关条（一行高度）；开启时展示：最后检查时间 + `CurrentFocusCard`（若有当前焦点块）+ 即将开始提醒小卡片（若有） |
| `CurrentFocusCard.tsx` | 当前焦点 TimeBlock 卡片。展示标题、时间范围；`in_progress` 状态显示 amber 脉冲高亮；操作按钮：**开始**（status=scheduled 时显示，调用 `startBlock`）/ **完成** / **跳过** / **延迟**，每次操作后同步刷新 `timeBlockStore` 和 `taskStore` |
| `ExecutionFeedbackDialog.tsx` | 结束反馈对话框，基于 Radix Dialog。当 `heartbeatStore.isFeedbackDialogOpen && pendingFeedbackBlock != null` 时渲染。展示 TimeBlock 信息 + 可选备注输入框 + Done/Skip/Delay 三个按钮。关闭时调用 `closeFeedbackDialog`，操作后刷新 Store |

#### `timeline/`

| 文件 | 说明 |
|---|---|
| `TodayTimeline.tsx` | 今日时间轴容器：固定高度滚动区 + `TimeRuler`（左侧刻度）+ `TimeBlockCard` 列表（绝对定位）+ `TimeBlockForm`（弹出编辑） |
| `TimeBlockCard.tsx` | 时间块卡片，绝对定位于时间轴。**V2 更新**：新增 `in_progress` 样式（amber 边框 + 脉冲色条 + ▶ 标识 + zIndex 提升）；`delayed` 样式（橙红色调 + 虚线边框 + 延迟标识，与灰色半透明的 `skipped` 明显区别）；新增 Delay 菜单项（在 `!isInactive` 条件下） |
| `TimeBlockForm.tsx` | 时间块创建/编辑表单（弹出式）：标题/时间/类型/锁定 + 冲突检测反馈 |
| `TimeRuler.tsx` | 左侧时间刻度尺，渲染 0~23 小时标记 |

#### `layout/`

| 文件 | 说明 |
|---|---|
| `AppLayout.tsx` | 应用主布局：左侧 Sidebar + 右侧内容区，根据 `activePage` 渲染 TodayPage/ChatPage/SettingsPage |
| `Sidebar.tsx` | 侧边栏导航：今日（TodayPage）/ 助手（ChatPage）/ 设置（SettingsPage）三个入口按钮 |

#### `chat/`

| 文件 | 说明 |
|---|---|
| `ChatPanel.tsx` | Chat 主面板：消息列表 + 自动滚动 + 加载历史 |
| `ChatMessage.tsx` | 单条消息气泡：用户/助手气泡 + 需要确认时展示确认/拒绝按钮 |
| `ChatInput.tsx` | 消息输入框：文本 textarea + 发送按钮 + Enter 发送（Shift+Enter 换行） |

#### `schedule/`

| 文件 | 说明 |
|---|---|
| `ScheduleTaskDialog.tsx` | 为 Task 选择时间并调用 ScheduleService 排期。支持手动选时间或使用推荐时间段 |

#### `shared/`

| 文件 | 说明 |
|---|---|
| `ConfirmDialog.tsx` | 通用确认对话框：title/description/confirmLabel/cancelLabel + destructive 变体（红色确认） |
| `StatusBadge.tsx` | 状态/优先级/类型标签组件。**V2 更新**：`BLOCK_STATUS_CONFIG` 新增 `delayed` 状态（橙色样式） |

#### `todo/`

| 文件 | 说明 |
|---|---|
| `TodoList.tsx` | 任务列表容器：加载状态 + `TodoFilters` + `TodoItem` 列表 + `TodoForm`（新建入口） |
| `TodoItem.tsx` | 单条任务项：标题/优先级/状态展示 + 编辑/删除/排期操作按钮 |
| `TodoForm.tsx` | 任务创建/编辑表单：标题/描述/截止日期/预估时长/优先级 |
| `TodoFilters.tsx` | 任务过滤器：按状态/优先级筛选，联动 taskStore |

### 3.7 `src/agent/` — Agent 系统（V1，V2 未修改）

| 文件 | 说明 |
|---|---|
| `AgentService.ts` | Agent 总协调器：接收用户输入 → 记录日志 → IntentParser 解析 → ToolRouter 路由 → 执行 Tool → 确认机制拦截 → 返回助手回复 |
| `IntentParser.ts` | 规则化自然语言意图解析器：正则 + 关键词匹配，提取 IntentType 和参数（任务标题、时间、日期等） |
| `ToolRouter.ts` | 工具注册表与路由：按 intent 查找对应 Tool、执行、检查 requiresConfirmation |
| `types.ts` | Agent 内部类型：`IntentType` 枚举（17 种）、`ParsedIntent`、`ToolResult`、`ToolDefinition` |
| `tools/BaseTool.ts` | Tool 抽象基类：定义 name/description/requiresConfirmation/execute 接口 |
| `tools/task/*.ts` | 任务相关 5 个 Tool：createTask / updateTask / deleteTask（需确认）/ listTasks / markTaskCompleted |
| `tools/timeblock/*.ts` | 时间块相关 5 个 Tool：createTimeBlock / updateTimeBlock / deleteTimeBlock（需确认）/ listTimeBlocks / bindTaskToTimeBlock |
| `tools/schedule/*.ts` | 排程相关 5 个 Tool：scheduleTask / rescheduleDay（需确认）/ detectConflicts / getFreeSlots / getTodayPlan |
| `tools/explain/*.ts` | 解释型 2 个 Tool：explainTask / explainSchedule（返回友好文本） |

### 3.8 `src/pages/` — 页面级组件

| 文件 | 说明 |
|---|---|
| `TodayPage.tsx` | 今日视图页。布局：左侧（宽 320px）TodoList + 右侧（flex-1）Timeline 列。**V2 更新**：接入 `heartbeatStore`，在 `useEffect` 中根据 `heartbeatEnabled` 控制 `startHeartbeat / stopHeartbeat`（cleanup 时停止）；在 Timeline 列顶部插入 `<HeartbeatPanel />`；挂载全局 `<ExecutionFeedbackDialog />` |
| `ChatPage.tsx` | Chat 页面，加载 `ChatPanel`，初始化时调用 `chatStore.loadHistory` |
| `SettingsPage.tsx` | 设置页面。**V2 更新**：新增 Heartbeat 设置区（开启开关 / 提前提醒分钟 1-30 / 检查间隔秒 10-300 / 自动弹出反馈开关），通过 `heartbeatStore.updateSettings` 写入 localStorage；保留数据存储说明区和关于区 |

### 3.9 `src/lib/` — 公共工具库

| 文件 | 说明 |
|---|---|
| `dateUtils.ts` | 日期时间工具：`getDayRange`（获取当日起止时间）、`formatTime`（HH:MM 格式化）、`getBlockTopPx`（时间块顶部像素位置）、`getBlockHeightPx`（时间块高度像素）、`getBlockDurationMinutes`（时间块时长分钟数） |
| `conflictDetector.ts` | 时间冲突检测：判断两个时间段是否重叠（`detectConflicts`），返回冲突的 TimeBlock 列表 |
| `scheduler.ts` | 排程算法：`findFreeSlots`（查找空闲时间段）、`findBestSlot`（按优先级选最佳时段）、`rescheduleDay`（全天重排） |
| `utils.ts` | 通用工具：`cn`（Tailwind 类名合并，基于 clsx + tailwind-merge） |

### 3.10 应用入口文件

| 文件 | 说明 |
|---|---|
| `src/main.tsx` | React 应用入口：调用 `runMigrations()` 初始化数据库，然后挂载根组件到 `#root` DOM 节点 |
| `src/App.tsx` | 根组件：包裹 `Toaster`（Sonner Toast 提供者）和 `AppLayout` |
| `src/index.css` | 全局样式：Tailwind CSS v4 导入指令，基础字体和滚动条样式 |

---

## 4. 数据库 Schema（V2 最终版）

共 5 张业务表 + 1 张版本追踪表，4 个 Migration 版本：

| Migration | 表/操作 | 说明 |
|---|---|---|
| v1 | `tasks` | id / title / description / deadline / estimated_duration_minutes / priority / status / category / is_flexible / can_split / created_at / updated_at / deleted_at |
| v2 | `time_blocks`（旧） | id / task_id / title / start_time / end_time / type / status（无 delayed）/ is_locked / source / created_at / updated_at / deleted_at；+ 3 个索引 |
| v3 | `agent_action_logs` / `conversation_messages` / `pending_confirmations` | Agent 系统三张表 |
| v4 | `time_blocks`（重建） | 在 v2 基础上扩展：status CHECK 新增 `delayed`；新增 8 个字段：reminder_sent_at / start_prompt_sent_at / end_prompt_sent_at / started_at / completed_at / skipped_at / delayed_at / feedback_note；旧数据完整迁移（新字段初始化为 NULL） |
| — | `schema_version` | 版本追踪：version INTEGER PRIMARY KEY + applied_at |

---

## 5. 技术栈

| 层级 | 技术 | 用途 |
|---|---|---|
| 桌面容器 | Tauri v2（Rust） | 本地窗口管理、进程生命周期、SQLite 插件注册 |
| 前端框架 | React 19 + TypeScript | UI 渲染与交互 |
| 构建工具 | Vite 6 | 开发热更新 + 生产构建 |
| 样式 | Tailwind CSS 4 | 原子化 CSS |
| UI 基础组件 | Radix UI（Dialog、DropdownMenu 等） | 无障碍基础组件 |
| 状态管理 | Zustand 5 + persist middleware | 前端全局状态 + localStorage 持久化（Heartbeat 设置） |
| 数据校验 | Zod 3 | 运行时类型安全（Service 层输入校验） |
| 数据库 | SQLite（via `@tauri-apps/plugin-sql`） | 本地持久化 |
| Toast 通知 | Sonner | UI 操作反馈提示 |
| 包管理 | pnpm | 依赖管理 |

---

## 6. 构建与运行

```bash
# 安装依赖
pnpm install

# 开发模式（Tauri + Vite HMR）
pnpm tauri dev

# 生产构建
pnpm tauri build

# 仅前端开发（不启动 Tauri，无法访问 SQLite）
pnpm dev

# TypeScript 类型检查
npx tsc --noEmit
```
