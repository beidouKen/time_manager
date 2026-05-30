# Time Manager V1 — 项目架构说明

> 文档版本：1.0  
> 生成日期：2026-05-14  
> 项目版本：V1 (Agent Tooling MVP)

---

## 1. 技术栈总览

| 层级 | 技术 | 用途 |
|------|------|------|
| 桌面容器 | Tauri v2 (Rust) | 本地窗口管理、进程生命周期、SQLite 插件注册 |
| 前端框架 | React 19 + TypeScript | UI 渲染与交互 |
| 构建工具 | Vite 6 | 开发热更新 + 生产构建 |
| 样式 | Tailwind CSS 4 | 原子化 CSS |
| UI 组件 | Radix UI + shadcn/ui 模式 | 无障碍基础组件 |
| 状态管理 | Zustand 5 | 前端全局状态 |
| 数据校验 | Zod 3 | 运行时类型安全 |
| 数据库 | SQLite (via `@tauri-apps/plugin-sql`) | 本地持久化 |
| 包管理 | pnpm | 依赖管理 |

---

## 2. 物理目录结构

```
time_manager/
├── docs/                        # 项目文档
│   ├── v0-closure-report.md     # V0 封板报告
│   ├── v1-closure-report.md     # V1 封板报告
│   └── V1/
│       └── architecture.md      # 本文件
├── src/                         # 前端 + 业务逻辑（TypeScript）
│   ├── agent/                   # V1 Agent 系统
│   │   ├── tools/               # Agent 工具集
│   │   │   ├── task/            # 任务相关 Tools
│   │   │   ├── timeblock/       # 时间块相关 Tools
│   │   │   ├── schedule/        # 排程相关 Tools
│   │   │   └── explain/         # 解释型 Tools
│   │   ├── AgentService.ts      # Agent 协调器
│   │   ├── IntentParser.ts      # 自然语言意图解析
│   │   ├── ToolRouter.ts        # 工具路由与分发
│   │   └── types.ts             # Agent 内部类型
│   ├── components/              # React UI 组件
│   │   ├── chat/                # Chat UI 组件
│   │   ├── layout/              # 布局组件（侧边栏、主框架）
│   │   ├── schedule/            # 排期对话框
│   │   ├── shared/              # 通用组件（按钮、对话框等）
│   │   ├── timeline/            # 时间轴相关组件
│   │   └── todo/                # 任务列表相关组件
│   ├── db/                      # 数据库层
│   │   ├── client.ts            # SQLite 连接管理
│   │   └── migrations.ts        # Schema 版本迁移
│   ├── lib/                     # 公共工具库
│   │   ├── conflictDetector.ts  # 时间冲突检测
│   │   ├── dateUtils.ts         # 日期时间工具函数
│   │   ├── scheduler.ts         # 排程算法
│   │   └── utils.ts             # 通用工具（cn 等）
│   ├── pages/                   # 页面级组件
│   │   ├── TodayPage.tsx        # 今日视图页
│   │   ├── ChatPage.tsx         # Agent Chat 页
│   │   └── SettingsPage.tsx     # 设置页
│   ├── repositories/            # 数据访问层
│   │   ├── interfaces/          # Repository 接口定义
│   │   └── sqlite/              # SQLite 实现
│   ├── services/                # 业务逻辑层（Service Layer）
│   ├── store/                   # Zustand 状态管理
│   ├── types/                   # 全局类型定义
│   ├── App.tsx                  # 根组件
│   ├── main.tsx                 # 入口文件
│   └── index.css                # 全局样式
├── src-tauri/                   # Rust 后端（Tauri）
│   ├── src/
│   │   ├── main.rs              # Tauri 入口
│   │   └── lib.rs               # 插件注册
│   ├── capabilities/            # Tauri 权限配置
│   ├── gen/                     # Tauri 生成的 schema
│   ├── Cargo.toml               # Rust 依赖声明
│   ├── tauri.conf.json          # Tauri 配置
│   └── build.rs                 # Rust 构建脚本
├── index.html                   # HTML 入口
├── package.json                 # Node.js 项目配置
├── pnpm-lock.yaml               # 依赖锁定
├── pnpm-workspace.yaml          # pnpm workspace 配置
├── tsconfig.json                # TypeScript 配置
├── vite.config.ts               # Vite 构建配置
├── .gitignore                   # Git 忽略规则
├── .npmrc                       # npm 配置
└── README.md                    # 项目说明
```

---

## 3. 逻辑分层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Tauri Desktop Shell                          │
│                  (Rust: 窗口管理 + SQLite 插件注册)                    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ WebView (加载前端)
┌───────────────────────────────▼─────────────────────────────────────┐
│                         UI Layer (React)                             │
│                                                                     │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │TodayPage│  │ ChatPage │  │Settings  │  │ Layout/Sidebar   │    │
│  └────┬────┘  └────┬─────┘  └──────────┘  └──────────────────┘    │
│       │             │                                               │
└───────┼─────────────┼───────────────────────────────────────────────┘
        │             │
┌───────▼─────────────▼───────────────────────────────────────────────┐
│                      State Layer (Zustand Stores)                    │
│                                                                     │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐        │
│  │taskStore │  │timeBlock   │  │ chatStore│  │ uiStore  │        │
│  │          │  │Store       │  │          │  │          │        │
│  └────┬─────┘  └─────┬──────┘  └────┬─────┘  └──────────┘        │
│       │               │              │                              │
└───────┼───────────────┼──────────────┼──────────────────────────────┘
        │               │              │
        │               │              ▼
        │               │   ┌─────────────────────────────────┐
        │               │   │       Agent System (V1)          │
        │               │   │                                  │
        │               │   │  AgentService (协调器)            │
        │               │   │       │                          │
        │               │   │       ├── IntentParser (解析)    │
        │               │   │       ├── ToolRouter (路由)      │
        │               │   │       ├── Tools (17个工具)       │
        │               │   │       ├── ActionLogService       │
        │               │   │       └── ConfirmationService    │
        │               │   └──────────────┬──────────────────┘
        │               │                  │
        ▼               ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Service Layer (业务规则中心)                       │
│                                                                     │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────────┐       │
│  │TaskService  │  │TimeBlockService  │  │ScheduleService  │       │
│  │(Zod校验,   │  │(Zod校验,         │  │(排期/移回/冲突) │       │
│  │ 状态守卫)   │  │ 状态守卫)         │  │                 │       │
│  └──────┬──────┘  └────────┬─────────┘  └────────┬────────┘       │
│         │                  │                      │                 │
└─────────┼──────────────────┼──────────────────────┼─────────────────┘
          │                  │                      │
          ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Repository Layer (数据访问)                        │
│                                                                     │
│  ┌───────────────┐  ┌─────────────────────┐  ┌──────────────────┐ │
│  │ITaskRepository│  │ITimeBlockRepository │  │IActionLog/       │ │
│  │(接口)         │  │(接口)               │  │IConversation/    │ │
│  └───────┬───────┘  └──────────┬──────────┘  │IConfirmation     │ │
│          │                     │              │(接口)            │ │
│          ▼                     ▼              └────────┬─────────┘ │
│  ┌───────────────┐  ┌─────────────────────┐  ┌───────▼──────────┐ │
│  │SqliteTask     │  │SqliteTimeBlock      │  │Sqlite*           │ │
│  │Repository     │  │Repository           │  │Repository        │ │
│  └───────┬───────┘  └──────────┬──────────┘  └────────┬─────────┘ │
│          │                     │                       │           │
└──────────┼─────────────────────┼───────────────────────┼───────────┘
           │                     │                       │
           ▼                     ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SQLite Database (本地文件)                         │
│                                                                     │
│  Tables: tasks, time_blocks, agent_action_logs,                     │
│          conversation_messages, pending_confirmations                │
│                                                                     │
│  通过 @tauri-apps/plugin-sql (Tauri IPC → Rust SQLite 驱动) 访问    │
└─────────────────────────────────────────────────────────────────────┘
```

### 数据流向说明

1. **用户操作 UI** → Zustand Store → Service Layer → Repository → SQLite
2. **用户 Chat 输入** → chatStore → AgentService → IntentParser → ToolRouter → Tool → Service Layer → Repository → SQLite
3. **Agent 操作记录** → AgentService 每步调用 → ActionLogService → SqliteActionLogRepository → SQLite
4. **危险操作确认** → AgentService 检测 Tool.requiresConfirmation → ConfirmationService → 返回等待确认 → 用户确认/拒绝 → 继续/取消执行

---

## 4. 各文件说明

### 4.1 项目根目录

| 文件 | 用途 |
|------|------|
| `package.json` | Node.js 项目配置，声明依赖、脚本命令 |
| `pnpm-lock.yaml` | pnpm 依赖版本锁定文件 |
| `pnpm-workspace.yaml` | pnpm workspace 配置 |
| `tsconfig.json` | TypeScript 编译器配置（严格模式，路径别名 `@/`） |
| `vite.config.ts` | Vite 构建配置（React 插件、Tailwind 插件、端口 1420） |
| `index.html` | 应用 HTML 入口，加载 `src/main.tsx` |
| `.gitignore` | Git 忽略规则 |
| `.npmrc` | npm/pnpm 配置 |
| `README.md` | 项目说明文档 |

### 4.2 `src-tauri/` — Rust 后端

| 文件 | 用途 |
|------|------|
| `src/main.rs` | Tauri 应用入口点，调用 `run()` |
| `src/lib.rs` | 注册 `tauri-plugin-sql` (SQLite) 插件到 Tauri app |
| `Cargo.toml` | Rust 依赖声明（tauri, tauri-plugin-sql, serde） |
| `build.rs` | Tauri 构建脚本 |
| `tauri.conf.json` | Tauri 应用配置（窗口大小、安全策略、构建命令） |
| `.cargo/config.toml` | Cargo 编译配置 |
| `capabilities/default.json` | Tauri 权限/能力配置 |
| `gen/schemas/` | Tauri 自动生成的 JSON Schema |

> Rust 后端职责极简：仅负责窗口管理和 SQLite 插件注册。所有业务逻辑在 TypeScript 前端实现。

### 4.3 `src/db/` — 数据库层

| 文件 | 用途 |
|------|------|
| `client.ts` | SQLite 连接单例管理，提供 `getDb()` 获取数据库实例 |
| `migrations.ts` | Schema 版本迁移定义（v1: tasks/time_blocks, v2: 索引, v3: agent 相关三表） |

### 4.4 `src/types/` — 类型定义

| 文件 | 用途 |
|------|------|
| `task.types.ts` | Task 实体接口 + Zod schema（字段定义、状态枚举、优先级枚举） |
| `timeblock.types.ts` | TimeBlock 实体接口 + Zod schema |
| `agent.types.ts` | ActionLog、ConversationMessage、PendingConfirmation 接口 + Zod schema |

### 4.5 `src/repositories/` — 数据访问层

#### 接口 (`interfaces/`)

| 文件 | 用途 |
|------|------|
| `ITaskRepository.ts` | Task 数据访问接口（CRUD + 按状态/优先级查询） |
| `ITimeBlockRepository.ts` | TimeBlock 数据访问接口（CRUD + 按日期/任务查询） |
| `IActionLogRepository.ts` | ActionLog 数据访问接口（创建、查询、更新） |
| `IConversationRepository.ts` | 对话消息数据访问接口（创建、查询、删除） |
| `IConfirmationRepository.ts` | 待确认操作数据访问接口（创建、按状态查询、更新、过期） |

#### SQLite 实现 (`sqlite/`)

| 文件 | 用途 |
|------|------|
| `SqliteTaskRepository.ts` | ITaskRepository 的 SQLite 实现（含软删除过滤） |
| `SqliteTimeBlockRepository.ts` | ITimeBlockRepository 的 SQLite 实现（含软删除过滤） |
| `SqliteActionLogRepository.ts` | IActionLogRepository 的 SQLite 实现 |
| `SqliteConversationRepository.ts` | IConversationRepository 的 SQLite 实现 |
| `SqliteConfirmationRepository.ts` | IConfirmationRepository 的 SQLite 实现 |

### 4.6 `src/services/` — 业务逻辑层

| 文件 | 用途 |
|------|------|
| `TaskService.ts` | Task 业务逻辑：Zod 输入校验、创建/更新/删除任务、状态流转守卫、软删除联动 TimeBlock |
| `TimeBlockService.ts` | TimeBlock 业务逻辑：创建/更新/删除时间块、Zod 校验、冲突检测调用 |
| `ScheduleService.ts` | 排程业务逻辑：为任务分配时间块、冲突检测、移回未排期 |
| `ActionLogService.ts` | Agent 操作日志服务：记录请求/Tool执行/成功/失败/取消 |
| `ConfirmationService.ts` | 确认机制服务：创建待确认、确认/拒绝/过期处理 |

### 4.7 `src/lib/` — 公共工具库

| 文件 | 用途 |
|------|------|
| `dateUtils.ts` | 日期时间工具函数（格式化、比较、获取当日范围等） |
| `conflictDetector.ts` | 时间块冲突检测算法（判断时间段是否重叠） |
| `scheduler.ts` | V1 排程算法：空闲槽查找、最佳时间段选择、优先级排序、全天重排 |
| `utils.ts` | 通用工具函数（`cn` 类名合并等） |

### 4.8 `src/store/` — 状态管理

| 文件 | 用途 |
|------|------|
| `taskStore.ts` | Task 状态管理：加载/创建/更新/删除任务的 Store + 异步 actions |
| `timeBlockStore.ts` | TimeBlock 状态管理：加载/创建/更新/删除时间块的 Store |
| `chatStore.ts` | Chat 状态管理：消息列表/发送/确认/加载历史/清空 |
| `uiStore.ts` | UI 状态管理：当前活跃页面（today/chat/settings）、选中日期 |

### 4.9 `src/agent/` — Agent 系统（V1 核心新增）

| 文件 | 用途 |
|------|------|
| `types.ts` | Agent 内部类型：IntentType 枚举、ParsedIntent、ToolResult、ToolDefinition 接口 |
| `IntentParser.ts` | 规则化自然语言意图解析器：正则+关键词匹配，提取意图和参数 |
| `ToolRouter.ts` | 工具注册表与路由：按 intent 查找 Tool、执行 Tool、确认检查 |
| `AgentService.ts` | Agent 总协调器：串联解析→日志→参数解析→确认→执行→回复的完整流程 |
| `tools/BaseTool.ts` | Tool 抽象基类：定义 name/description/requiresConfirmation/execute 接口 |

#### `src/agent/tools/task/` — 任务工具

| 文件 | 用途 |
|------|------|
| `createTaskTool.ts` | 创建任务工具：调用 TaskService.createTask |
| `updateTaskTool.ts` | 更新任务工具：调用 TaskService.updateTask |
| `deleteTaskTool.ts` | 删除任务工具（需确认）：调用 TaskService.deleteTask |
| `listTasksTool.ts` | 列出任务工具：按状态/日期过滤查询 |
| `markTaskCompletedTool.ts` | 标记任务完成工具：调用 TaskService.updateTask 设置 status=done |

#### `src/agent/tools/timeblock/` — 时间块工具

| 文件 | 用途 |
|------|------|
| `createTimeBlockTool.ts` | 创建时间块工具：调用 TimeBlockService.createTimeBlock |
| `updateTimeBlockTool.ts` | 更新时间块工具：调用 TimeBlockService.updateTimeBlock |
| `deleteTimeBlockTool.ts` | 删除时间块工具（需确认）：调用 TimeBlockService.deleteTimeBlock |
| `listTimeBlocksTool.ts` | 列出时间块工具：按日期范围查询 |
| `bindTaskToTimeBlockTool.ts` | 绑定任务到时间块工具：调用 ScheduleService.scheduleTask |

#### `src/agent/tools/schedule/` — 排程工具

| 文件 | 用途 |
|------|------|
| `scheduleTaskTool.ts` | 自动排期工具：为任务查找空闲时间段并创建时间块 |
| `rescheduleDayTool.ts` | 重排当日工具（需确认）：调用 scheduler.rescheduleDay 重新安排 |
| `detectConflictsTool.ts` | 冲突检测工具：查找指定日期的时间冲突 |
| `getFreeSlotsTool.ts` | 查询空闲槽工具：返回指定日期可用时间段 |
| `getTodayPlanTool.ts` | 获取今日计划工具：返回今日所有时间块和关联任务 |

#### `src/agent/tools/explain/` — 解释工具

| 文件 | 用途 |
|------|------|
| `explainTaskTool.ts` | 解释任务工具：返回任务详细信息的友好文本 |
| `explainScheduleTool.ts` | 解释排程工具：返回指定日期的安排概览 |

### 4.10 `src/components/` — UI 组件

#### `components/layout/`

| 文件 | 用途 |
|------|------|
| `AppLayout.tsx` | 应用主布局：侧边栏 + 内容区，根据 activePage 渲染不同页面 |
| `Sidebar.tsx` | 侧边栏导航：今日/助手/设置三个入口 |

#### `components/chat/`（V1 新增）

| 文件 | 用途 |
|------|------|
| `ChatPanel.tsx` | Chat 主面板：消息列表 + 输入框 + 自动滚动 |
| `ChatMessage.tsx` | 单条消息组件：用户/助手消息气泡 + 确认按钮（如需） |
| `ChatInput.tsx` | 输入框组件：文本输入 + 发送按钮 + Enter 快捷键 |

#### `components/todo/`

| 文件 | 用途 |
|------|------|
| `TodoList.tsx` | 任务列表容器：加载、过滤、展示任务列表 |
| `TodoItem.tsx` | 单条任务项：展示标题/优先级/状态/操作按钮 |
| `TodoForm.tsx` | 任务创建/编辑表单 |
| `TodoFilters.tsx` | 任务过滤器：按状态/优先级筛选 |

#### `components/timeline/`

| 文件 | 用途 |
|------|------|
| `TodayTimeline.tsx` | 今日时间轴容器：时间刻度 + 时间块卡片 |
| `TimeBlockCard.tsx` | 时间块卡片：展示时间范围/标题/关联任务 |
| `TimeBlockForm.tsx` | 时间块创建/编辑表单 |
| `TimeRuler.tsx` | 时间刻度尺：24h 刻度线渲染 |

#### `components/schedule/`

| 文件 | 用途 |
|------|------|
| `ScheduleTaskDialog.tsx` | 排期对话框：为任务选择时间并排期 |

#### `components/shared/`

| 文件 | 用途 |
|------|------|
| `ConfirmDialog.tsx` | 通用确认对话框组件 |
| `StatusBadge.tsx` | 状态标签组件（展示 Task 状态、优先级等） |

### 4.11 `src/pages/` — 页面级组件

| 文件 | 用途 |
|------|------|
| `TodayPage.tsx` | 今日视图：左侧任务列表 + 右侧时间轴 |
| `ChatPage.tsx` | Agent Chat 页面：加载 ChatPanel |
| `SettingsPage.tsx` | 设置页面（当前为占位） |

### 4.12 应用入口

| 文件 | 用途 |
|------|------|
| `src/main.tsx` | React 应用入口：挂载到 DOM、初始化数据库连接 |
| `src/App.tsx` | 根组件：AppLayout + Toast Provider |
| `src/index.css` | 全局 CSS：Tailwind 导入 + 基础样式 |

---

## 5. 关键设计决策

### 5.1 Rust 后端极简化

Rust 仅注册 `tauri-plugin-sql`，所有业务逻辑、数据访问、Agent 逻辑均在 TypeScript 中实现。这降低了双语言维护成本，保持架构简单。

### 5.2 Repository 接口模式

数据访问通过接口定义（`I*Repository`），当前仅有 SQLite 实现。未来如需替换存储后端（如 IndexedDB、远程 API），只需新增实现而无需修改 Service 层。

### 5.3 Service Layer 作为业务规则中心

所有 Zod 校验、状态守卫（如任务已完成不可再编辑）、冲突检测等业务规则集中在 Service 层。无论是 UI 直接操作还是 Agent Tool 调用，都经过同一套规则。

### 5.4 Agent 不直接访问数据

Agent 相关代码（Parser、Router、Tool）不允许直接操作 Repository 或数据库。Tool 必须通过 Service Layer 执行操作，确保业务规则始终被遵守。

### 5.5 确认机制与日志

危险操作（删除、重排）通过 `requiresConfirmation` 标记，AgentService 自动拦截并走确认流程。所有操作均记录到 `agent_action_logs`，确保可追溯。

---

## 6. 数据库 Schema（V1 最终版）

共 5 张表，3 个版本的 Migration：

| Migration | 表 | 说明 |
|-----------|-----|------|
| v1 | `tasks` | 任务：id, title, description, status, priority, estimated_duration, due_date, created_at, updated_at, deleted_at |
| v1 | `time_blocks` | 时间块：id, title, start_time, end_time, type, task_id, created_at, updated_at, deleted_at |
| v2 | (索引) | tasks 的 status/priority 索引，time_blocks 的 start_time/task_id 索引 |
| v3 | `agent_action_logs` | Agent 操作日志 |
| v3 | `conversation_messages` | 对话历史 |
| v3 | `pending_confirmations` | 待确认操作 |

---

## 7. 构建与运行

```bash
# 安装依赖
pnpm install

# 开发模式（Tauri + Vite HMR）
pnpm tauri dev

# 生产构建
pnpm tauri build

# 仅前端开发（不启动 Tauri）
pnpm dev

# TypeScript 类型检查
npx tsc --noEmit
```
