# B.6 Completed 任务归档 — 设计稿

> **状态**：P2 设计稿，本轮（V3.7）不实施。
> **前置条件**：V3.7 P0 / P1 全部完成并通过验收。

---

## 1. 问题背景

### 1.1 现状

| 维度 | 现状 |
|------|------|
| `tasks` 表结构 | 无 `archived_at`、无 `completed_at` 字段 |
| `TaskStatus` | `todo \| scheduled \| in_progress \| done \| cancelled` |
| `TodoList` 默认过滤 | `status !== "cancelled"`（`done` 任务始终展示） |
| `TaskFilter` | `{ status?, excludeDeleted? }`，无归档过滤 |
| 软删除 | 依赖 `deleted_at`，`archived_at` 尚未存在 |

**问题**：随着时间推移，`done` 状态的任务在列表中堆积，干扰当前待办的查阅。现有的 `deleted_at` 是不可逆的软删除，不适合作为"归档"语义（归档可恢复）。

### 1.2 设计目标

1. 为 `done` 任务提供**可逆的归档操作**，区别于不可逆的软删除。
2. 任务列表默认**只展示未归档条目**，不展示 `archived_at` 非空的任务。
3. 提供独立的"归档"筛选 tab，允许用户查看和恢复已归档任务。
4. 支持**手动归档**；**自动归档**（N 天后自动写入）作为后续可选项保留扩展点。
5. 不引入 `completed_at`，沿用 `status='done'`；`archived_at` 独立表达"已归档"语义。

---

## 2. 数据层变更

### 2.1 DB Migration（版本 6）

```sql
-- migrations.ts v6
ALTER TABLE tasks ADD COLUMN archived_at TEXT;
```

幂等检查：同 V5 模式，用 `tableHasColumn(db, 'tasks', 'archived_at')` 守护。

```ts
// src/db/migrations.ts 追加
{
  version: 6,
  async run(db) {
    const hasColumn = await tableHasColumn(db, "tasks", "archived_at");
    if (hasColumn) return;
    await db.execute(`ALTER TABLE tasks ADD COLUMN archived_at TEXT`);
  },
}
```

### 2.2 Task 类型扩展

```ts
// src/types/task.types.ts
export interface Task {
  // ...原字段
  deleted_at?: string;
  /** V3.8: 归档时间戳。非空表示已归档；空表示活跃。可通过 unarchiveTask 恢复。 */
  archived_at?: string;
}
```

### 2.3 TaskFilter 扩展

```ts
// src/types/task.types.ts
export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  excludeDeleted?: boolean;
  /**
   * true（默认）：过滤掉 archived_at 非空的记录。
   * false：包含已归档的记录。
   * "only"：只返回已归档的记录。
   */
  excludeArchived?: boolean | "only";
}
```

**默认行为**：`excludeArchived` 缺省时 = `true`，即所有不显式指定的查询均排除归档任务。

### 2.4 Repository 变更

```ts
// src/repositories/interfaces/ITaskRepository.ts
export interface ITaskRepository {
  findAll(filter?: TaskFilter): Promise<Task[]>;
  findById(id: string): Promise<Task | null>;
  create(data: CreateTaskInput): Promise<Task>;
  update(id: string, data: UpdateTaskInput): Promise<Task>;
  softDelete(id: string): Promise<void>;
  /** V3.8: 写入 archived_at = nowISO */
  archive(id: string): Promise<void>;
  /** V3.8: 清空 archived_at */
  unarchive(id: string): Promise<void>;
}
```

`SqliteTaskRepository.findAll` 的 SQL WHERE 子句增加：

```sql
-- excludeArchived = true（默认）
AND (archived_at IS NULL)

-- excludeArchived = "only"
AND (archived_at IS NOT NULL)

-- excludeArchived = false
-- 不追加任何条件
```

---

## 3. Service 层变更

### 3.1 TaskService 新增方法

```ts
// src/services/TaskService.ts

/**
 * V3.8: 将 done 状态的任务标记为已归档。
 * 仅允许对 status='done' 或 status='cancelled' 的任务归档。
 * 已删除的任务不允许归档（语义：deleted > archived）。
 */
async archiveTask(id: string): Promise<Task> {
  const task = await this.repo.findById(id);
  if (!task) throw new Error("任务不存在");
  if (task.deleted_at) throw new Error("已删除的任务不能归档");
  if (!["done", "cancelled"].includes(task.status)) {
    throw new Error("只有已完成或已取消的任务才能归档");
  }
  await this.repo.archive(id);
  return this.repo.findById(id) as Promise<Task>;
}

/**
 * V3.8: 取消归档，将任务恢复到活跃列表。
 * 恢复后 archived_at 清空，status 保持不变（仍为 done/cancelled）。
 */
async unarchiveTask(id: string): Promise<Task> {
  const task = await this.repo.findById(id);
  if (!task) throw new Error("任务不存在");
  if (!task.archived_at) throw new Error("该任务未被归档");
  await this.repo.unarchive(id);
  return this.repo.findById(id) as Promise<Task>;
}
```

### 3.2 自动归档扩展点（后置）

预留接口，V3.8 不实施：

```ts
/**
 * [后置] 自动归档超过 N 天的 done 任务。
 * 建议在应用启动时或 Heartbeat 服务内定期调用。
 * @param daysOld - 完成后超过多少天触发归档（建议默认 30）
 */
async autoArchiveOldDoneTasks(daysOld = 30): Promise<number> {
  // TODO: 实现逻辑
  // 1. 查询 status='done' AND archived_at IS NULL 的任务
  // 2. 计算 updated_at + daysOld < now
  // 3. 批量写入 archived_at
  throw new Error("Not implemented");
}
```

### 3.3 Agent 工具侧

**本版本不向 ToolRouter 注册归档工具**。原因：
- 归档操作对用户来说是 UI 主动行为，语义边界清晰，无需 Agent 介入。
- 如有需要，后续可注册 `archive_task` tool（风险等级 `confirm`）。

---

## 4. UI 层变更

### 4.1 TodoFilters 新增"归档"Tab

```tsx
// src/components/todo/TodoFilters.tsx
// 当前 tabs: "全部" | "待办" | "进行中" | "已完成" | "已取消"
// 新增: "归档"

type FilterValue = TaskStatus | "all" | "archived";
```

Tab 顺序建议：`全部 | 待办 | 进行中 | 已完成 | 已取消 | 归档`

### 4.2 TodoList 过滤逻辑变更

```tsx
// src/components/todo/TodoList.tsx

// 当前（V3.7）
useEffect(() => {
  loadTasks({ excludeDeleted: true });
}, [loadTasks]);

// 建议（V3.8）
useEffect(() => {
  if (filter === "archived") {
    loadTasks({ excludeDeleted: true, excludeArchived: "only" });
  } else {
    loadTasks({ excludeDeleted: true, excludeArchived: true }); // 默认排除归档
  }
}, [loadTasks, filter]);

// filteredTasks 过滤
const filteredTasks = tasks.filter((task) => {
  if (task.deleted_at) return false;
  if (filter === "archived") return !!task.archived_at;
  if (task.archived_at) return false; // 非归档 tab 隐藏已归档
  if (filter === "all") return task.status !== "cancelled";
  return task.status === filter;
});
```

### 4.3 TodoItem 归档操作入口

在 `done` / `cancelled` 状态任务的操作菜单中新增：

```
[归档]  →  调用 taskStore.archiveTask(id)
```

在"归档" tab 下展示的任务操作菜单中新增：

```
[取消归档]  →  调用 taskStore.unarchiveTask(id)
```

视觉区分：归档 tab 中任务文字色调略灰，标注归档日期。

### 4.4 taskStore 扩展

```ts
// src/store/taskStore.ts
interface TaskActions {
  // ...原有 actions
  archiveTask: (id: string) => Promise<void>;
  unarchiveTask: (id: string) => Promise<void>;
}
```

---

## 5. 现有行为保护

| 场景 | 变更前 | 变更后 |
|------|--------|--------|
| `getTasks()` 默认 | 返回所有未删除 | 返回所有未删除且未归档 |
| Agent `list_tasks` tool | 同上 | 同上（过滤归档任务） |
| `deleteTask(id)` | 软删除 | 不变 |
| HeartbeatService 查询 | 无影响 | 无影响（按 time_block 查询，不过 tasks 表） |
| `getActiveTasks()` | 返回 todo/scheduled/in_progress | 不变（这些状态不会被归档） |

---

## 6. 影响文件汇总

| 文件 | 变更类型 |
|------|---------|
| `src/db/migrations.ts` | 新增 v6 migration（ALTER TABLE tasks ADD COLUMN archived_at TEXT） |
| `src/types/task.types.ts` | Task + `archived_at?`；TaskFilter + `excludeArchived?` |
| `src/repositories/interfaces/ITaskRepository.ts` | + `archive()` / `unarchive()` |
| `src/repositories/sqlite/SqliteTaskRepository.ts` | 实现 `archive`/`unarchive`；`findAll` 增加 `excludeArchived` 条件 |
| `src/services/TaskService.ts` | + `archiveTask()` / `unarchiveTask()` / `autoArchiveOldDoneTasks()`（stub） |
| `src/store/taskStore.ts` | + `archiveTask` / `unarchiveTask` actions |
| `src/components/todo/TodoFilters.tsx` | 新增"归档" tab，扩展 FilterValue 类型 |
| `src/components/todo/TodoList.tsx` | 按 filter 切换 loadTasks 参数；filteredTasks 逻辑排除已归档 |
| `src/components/todo/TodoItem.tsx` | done/cancelled 状态新增「归档」操作；归档 tab 新增「取消归档」操作 |

---

## 7. 测试矩阵（待实施时编写）

```
src/services/__tests__/TaskService.archive.test.ts
  - archiveTask(done任务) → archived_at 非空
  - archiveTask(todo任务) → 抛错
  - archiveTask(已删除任务) → 抛错
  - unarchiveTask → archived_at 清空，status 不变
  - getTasks({ excludeArchived: true }) 不返回已归档任务
  - getTasks({ excludeArchived: "only" }) 只返回已归档任务
  - getTasks({ excludeArchived: false }) 返回全部（含归档）

src/store/__tests__/taskStore.archive.test.ts
  - archiveTask → 从默认列表消失
  - 切换到归档 tab → 再次出现
  - unarchiveTask → 重回默认列表
```

---

## 8. 实施前置条件 & 风险点

1. **`excludeArchived` 默认值**：默认 `true` 意味着现有所有未显式传 `excludeArchived` 的调用不受影响。需检查 `Agent list_tasks tool` / `getActiveTasks()` 的调用是否正确。
2. **migration 幂等性**：与 v5 保持相同的 `tableHasColumn` 守护模式，避免重复执行。
3. **不引入 `completed_at`**：依赖 `updated_at` 推算归档阈值（自动归档功能后置）。若将来需要精确完成时间，需单独 migration。
4. **已有 `done` 数据**：migration 后历史 `done` 任务 `archived_at = NULL`，默认仍展示在列表中，用户可手动归档。

---

*文档版本：V3.7 设计阶段 | 撰写日期：2026-05-30*
