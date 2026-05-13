# Time Manager — V0 本地时间管理原型

> 一个面向学生和白领的桌面端时间管理应用，V0 阶段专注于本地可运行的结构化原型，实现从 **Todo 输入 → 安排日程 → 时间轴展示 → 状态流转 → 移回 Todo** 的完整核心闭环。

---

## 目录

- [产品目标](#产品目标)
- [技术栈](#技术栈)
- [架构分层](#架构分层)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [核心功能说明](#核心功能说明)
- [数据库 Schema](#数据库-schema)
- [开发指令速查](#开发指令速查)
- [V0 边界说明](#v0-边界说明)

---

## 产品目标

| 目标 | 说明 |
|---|---|
| 核心闭环 | Todo → 安排到 Timetable → 时间轴展示 → 手动调整 → 移回 Todo |
| 运行形态 | 本地桌面应用，无网络依赖，无登录 |
| 数据存储 | 本地 SQLite，数据不离开用户设备 |
| 稳定优先 | V0 不引入 AI Agent、自动排程等复杂能力 |

---

## 技术栈

| 层级 | 技术选型 | 理由 |
|---|---|---|
| 桌面壳 | **Tauri 2.x** (Rust) | 比 Electron 体积小、性能好，Rust 侧易于未来扩展 |
| 前端框架 | **React 19 + TypeScript** | 生态成熟，类型安全 |
| 状态管理 | **Zustand** | 轻量，API 简洁，适合中等复杂度状态 |
| 数据库 | **SQLite** via `tauri-plugin-sql` | 本地零配置，官方插件支持 |
| UI 组件 | **Tailwind CSS v4 + Radix UI** | Tailwind 极速样式，Radix 无障碍原语 |
| 日期处理 | **date-fns** | 轻量 Tree-shakeable，无副作用 |
| 数据校验 | **zod** | 前端与 IPC 边界双重校验 |
| 构建工具 | **Vite 6** | Tauri 官方推荐，HMR 极速 |
| 包管理 | **pnpm** | 磁盘占用小，依赖隔离清晰 |

---

## 架构分层

```
┌─────────────────────────────────────────────────┐
│              React UI Layer                     │
│  TodoList / TodayTimeline / Dialogs / Settings  │
├─────────────────────────────────────────────────┤
│           Zustand Store Layer                   │
│     taskStore / timeBlockStore / uiStore        │
├─────────────────────────────────────────────────┤
│           Service Layer (TypeScript)            │
│  TaskService / TimeBlockService / ScheduleService│
├─────────────────────────────────────────────────┤
│         Repository Interface (TypeScript)       │
│     ITaskRepository / ITimeBlockRepository      │
├─────────────────────────────────────────────────┤
│      SQLite Repository Implementation           │
│  SqliteTaskRepository / SqliteTimeBlockRepository│
├─────────────────────────────────────────────────┤
│          tauri-plugin-sql (IPC Bridge)          │
├─────────────────────────────────────────────────┤
│             SQLite 本地文件                      │
└─────────────────────────────────────────────────┘
```

**设计原则**：UI 层不写 SQL；Service 层不感知存储实现；Repository Interface 是唯一契约，未来可无缝替换为云端 API。

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **Rust** (通过 [rustup](https://rustup.rs/) 安装)
- **pnpm** (`npm install -g pnpm`)
- **Windows**：需要 Visual Studio Build Tools（含 MSVC 工具链）

### 安装依赖

```bash
pnpm install
```

### 启动开发模式

```bash
pnpm tauri dev
```

首次启动会编译 Rust，大约需要 2-5 分钟，后续热重载很快。

### 仅运行前端（用于纯 UI 调试）

```bash
pnpm dev
```

### 构建生产版本

```bash
pnpm tauri build
```

---

## 项目结构

```
time_manager/
├── src/                          # React 前端源码
│   ├── main.tsx                  # 入口
│   ├── App.tsx                   # 根组件（数据库初始化）
│   ├── index.css                 # 全局样式（Tailwind v4）
│   ├── types/                    # 类型定义 + zod schema
│   │   ├── task.types.ts
│   │   └── timeblock.types.ts
│   ├── db/                       # 数据库层
│   │   ├── client.ts             # SQLite 连接单例
│   │   └── migrations.ts         # 迁移执行器（schema_version 追踪）
│   ├── repositories/             # 数据访问层
│   │   ├── interfaces/           # Repository 接口定义
│   │   └── sqlite/               # SQLite 实现
│   ├── services/                 # 业务逻辑层
│   │   ├── TaskService.ts
│   │   ├── TimeBlockService.ts
│   │   └── ScheduleService.ts    # 核心操作：安排 & 移回
│   ├── store/                    # Zustand 状态
│   │   ├── taskStore.ts
│   │   ├── timeBlockStore.ts
│   │   └── uiStore.ts
│   ├── components/               # UI 组件
│   │   ├── layout/               # AppLayout、Sidebar
│   │   ├── todo/                 # TodoList、TodoItem、TodoForm、TodoFilters
│   │   ├── timeline/             # TodayTimeline、TimeBlockCard、TimeBlockForm、TimeRuler
│   │   ├── schedule/             # ScheduleTaskDialog
│   │   └── shared/               # ConfirmDialog、StatusBadge
│   ├── pages/
│   │   ├── TodayPage.tsx         # 主页（左：Todo，右：Timeline）
│   │   └── SettingsPage.tsx
│   └── lib/
│       ├── dateUtils.ts          # date-fns 封装 + 时间轴定位计算
│       ├── conflictDetector.ts   # 时间冲突检测
│       └── utils.ts              # cn() tailwind merge 工具
├── src-tauri/                    # Tauri Rust 后端
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs                # 注册 tauri-plugin-sql
│   ├── capabilities/
│   │   └── default.json          # IPC 权限声明
│   ├── icons/                    # 应用图标
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── package.json
├── vite.config.ts
├── tsconfig.json
└── pnpm-workspace.yaml
```

---

## 核心功能说明

### 操作① 安排任务到日程

在 Todo 列表中，点击任意任务的「···」菜单 → **安排到日程**，弹出时间选择对话框：

- 输入时间块标题、选择开始/结束时间
- 实时检测时间冲突，冲突时高亮警告并禁止提交
- 确认后在 Timeline 生成 TimeBlock，任务状态更新为 `scheduled`

```
Task(todo) ──[scheduleTaskToTimeBlock]──→ TimeBlock(scheduled) + Task(scheduled)
```

### 操作② 移回待办

在 Timeline 中，悬浮任意 **task 类型** 的 TimeBlock → 点击「···」菜单 → **移回 Todo**：

- 软删除该 TimeBlock（`deleted_at` 置为当前时间）
- 若该 Task 仍有其他活跃 TimeBlock → 状态保持 `scheduled`
- 若该 Task 无其他 TimeBlock → 状态更新回 `todo`，重新出现在 Todo 列表

```
TimeBlock(scheduled) ──[moveTimeBlockBackToTask]──→ Task(todo 或 scheduled)
```

**约束规则：**

| 场景 | 行为 |
|---|---|
| `event / break / routine` 类型 | 不显示「移回 Todo」按钮 |
| TimeBlock 状态为 `done` | 禁止移回，Toast 提示重建 |
| TimeBlock 状态为 `in_progress` | 禁止移回，提示先标记完成或取消 |
| 删除 Task 后对应 TimeBlock | `task_id` 自动置空（`ON DELETE SET NULL`），Timeline 正常渲染为 orphan block |

---

## 数据库 Schema

### tasks 表

```sql
CREATE TABLE tasks (
    id                        TEXT PRIMARY KEY,
    title                     TEXT NOT NULL,
    description               TEXT,
    deadline                  TEXT,                      -- ISO 8601
    estimated_duration_minutes INTEGER,
    priority                  TEXT NOT NULL DEFAULT 'medium'
                              CHECK(priority IN ('low','medium','high','urgent')),
    status                    TEXT NOT NULL DEFAULT 'todo'
                              CHECK(status IN ('todo','scheduled','in_progress','done','cancelled')),
    category                  TEXT,
    is_flexible               INTEGER NOT NULL DEFAULT 1,
    can_split                 INTEGER NOT NULL DEFAULT 0,
    created_at                TEXT NOT NULL,
    updated_at                TEXT NOT NULL,
    deleted_at                TEXT                       -- NULL = 未删除（软删除）
);
```

### time_blocks 表

```sql
CREATE TABLE time_blocks (
    id          TEXT PRIMARY KEY,
    task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,  -- 删 task 自动置空
    title       TEXT NOT NULL,
    start_time  TEXT NOT NULL,   -- ISO 8601
    end_time    TEXT NOT NULL,   -- ISO 8601
    type        TEXT NOT NULL DEFAULT 'task'
                CHECK(type IN ('task','event','break','routine')),
    status      TEXT NOT NULL DEFAULT 'scheduled'
                CHECK(status IN ('scheduled','in_progress','done','skipped','cancelled')),
    is_locked   INTEGER NOT NULL DEFAULT 0,
    source      TEXT NOT NULL DEFAULT 'manual'
                CHECK(source IN ('manual','system')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
```

---

## 开发指令速查

```bash
# 安装依赖
pnpm install

# 启动 Tauri 开发模式（前端 + 桌面壳）
pnpm tauri dev

# 仅启动前端开发服务器
pnpm dev

# TypeScript 类型检查
pnpm exec tsc --noEmit

# 仅构建前端
pnpm build

# 构建完整桌面应用
pnpm tauri build

# 检查 Rust 代码（不编译最终产物）
cd src-tauri && cargo check
```

---

## V0 边界说明

### V0 包含

- Task 增删改查 + 状态流转
- 今日时间轴（TodayTimeline）
- Task → TimeBlock 安排操作（含冲突检测）
- TimeBlock → Task 移回操作
- 基础设置页
- 本地 SQLite 持久化

### V0 不包含（计划后续版本）

| 功能 | 预计版本 |
|---|---|
| 拖拽调整 TimeBlock | V1 |
| 周视图 / 月视图 | V1 |
| AI Agent / 自然语言输入 | V1+ |
| Heartbeat 主动推送 | V1+ |
| 桌面宠物 | V1+ |
| 云端同步 / 多设备 | V2 |
| 用户登录 / 账号体系 | V2 |
| 移动端（iOS / Android）| V2 |
| 外部日历接入（Google / Apple）| V2 |
| 重复任务 / 任务依赖 | V1+ |
