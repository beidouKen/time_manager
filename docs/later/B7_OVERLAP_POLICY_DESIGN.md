# B.7 Task 重叠策略（OverlapMode）— 设计稿

> **状态**：P2 设计稿，本轮（V3.7）不实施。
> **前置条件**：V3.7 P0 / P1 全部完成并通过验收。

---

## 1. 问题背景

### 1.1 当前冲突处理现状（按层级）

| 层级 | 文件 | 当前行为 | 问题 |
|------|------|---------|------|
| `ScheduleService.scheduleTaskToTimeBlock` | `src/services/ScheduleService.ts:65` | **strict throw**：有冲突直接抛错，阻止创建 | 用户无法手动确认重叠 |
| `TimeBlockService.createTimeBlock` | `src/services/TimeBlockService.ts:47` | **不检测冲突** | 直接创建绕过检测 |
| `ScheduleTaskDialog` / `TimeBlockForm` | UI 组件 | **UI 警告 + 禁用提交按钮** | 用户完全被阻止，无二次确认 |
| Agent 推荐路径 | `RecommendationPlanner` → `get_free_slots` | **走空闲槽，天然避开** | 正常，无需修改 |
| Agent `precheckPlanAction` | `AgentService.ts:960` | **strict precheck**，冲突时返回 `ok: false` | 同 ScheduleService |

**核心矛盾**：现有设计"一律严格拒绝重叠"，导致：
1. 用户无法安排 `break` / `routine` 类型的时间块（如休息、日常事务）与已有任务重叠。
2. 用户有意安排重叠（如"这两件事可以并行"）时被强制阻止。
3. `TimeBlockService.createTimeBlock` 不检测冲突形成漏洞。

### 1.2 设计目标

1. 引入三级 `OverlapMode`，覆盖严格 / 警告 / 允许三种策略。
2. 全局配置默认 `strict`，与现有行为完全向后兼容。
3. 区分时间块类型的语义差异：`event/task` 类型维持 `strict`；`break/routine` 允许重叠。
4. Agent 自动排程路径**始终 strict**（走空闲槽），不受 OverlapMode 影响。
5. `detectConflicts` 纯函数化，返回信息而非抛错，让调用方决策。

---

## 2. 核心抽象：OverlapMode

### 2.1 类型定义

```ts
// src/types/schedule.types.ts（新文件）

/**
 * 时间块重叠处理模式。
 *
 * - strict:       有冲突则阻止（throw / 返回错误）。现有默认行为。
 * - warn:         有冲突时返回警告，但允许继续写入（UI 展示二次确认对话框）。
 * - allow_manual: 忽略冲突，直接写入（仅限用户手动操作，Agent 路径禁止使用）。
 */
export type OverlapMode = "strict" | "warn" | "allow_manual";

/** 冲突检测结果（纯数据，不抛错） */
export interface OverlapCheckResult {
  hasConflict: boolean;
  conflicts: ConflictSummary[];
}

export interface ConflictSummary {
  blockId: string;
  title: string;
  start_time: string;
  end_time: string;
}
```

### 2.2 全局设置（后置）

```ts
// 预留：未来接入用户设置面板
// src/store/settingsStore.ts（待创建）
interface AppSettings {
  /** 全局默认重叠模式，存 localStorage（不进 DB） */
  defaultOverlapMode: OverlapMode; // 默认 "strict"
}
```

**本版本实施范围**：不实现全局设置 UI，`OverlapMode` 通过调用方参数显式传入；全局默认 `"strict"` 保持向后兼容。

---

## 3. 核心变更：`detectConflicts` 纯函数化

### 3.1 现状

```ts
// src/lib/conflictDetector.ts
// 已是纯函数，返回 { hasConflict, conflictingBlocks }，不抛错 ✓
```

`conflictDetector.ts` **已是纯函数**，无需改动。问题出在上层调用方（`ScheduleService`）收到结果后直接 `throw`。

### 3.2 封装 overlapCheck 辅助函数

```ts
// src/lib/conflictDetector.ts 新增导出

/**
 * 根据 OverlapMode 处理冲突检测结果：
 * - strict:       有冲突时抛出 ConflictError
 * - warn:         有冲突时返回 warnings（不抛错）
 * - allow_manual: 始终返回空 warnings（忽略冲突）
 */
export function applyOverlapMode(
  result: ConflictResult,
  mode: OverlapMode
): { ok: true; warnings: ConflictSummary[] } | never {
  if (!result.hasConflict || mode === "allow_manual") {
    return { ok: true, warnings: [] };
  }

  const warnings: ConflictSummary[] = result.conflictingBlocks.map((b) => ({
    blockId: b.id,
    title: b.title,
    start_time: b.start_time,
    end_time: b.end_time,
  }));

  if (mode === "strict") {
    const titles = result.conflictingBlocks.map((b) => b.title).join("、");
    throw new ConflictError(`时间冲突：与「${titles}」重叠，请调整时间`, warnings);
  }

  // warn: 返回 warnings，由调用方处理
  return { ok: true, warnings };
}

export class ConflictError extends Error {
  constructor(
    message: string,
    public readonly conflicts: ConflictSummary[]
  ) {
    super(message);
    this.name = "ConflictError";
  }
}
```

---

## 4. Service 层变更

### 4.1 ScheduleService

```ts
// src/services/ScheduleService.ts

export interface ScheduleTaskOptions {
  /** 重叠模式，默认 "strict"（向后兼容） */
  overlapMode?: OverlapMode;
}

export interface ScheduleTaskResult {
  block: TimeBlock;
  /** 警告列表（warn 模式下可能非空） */
  warnings: ConflictSummary[];
}

async scheduleTaskToTimeBlock(
  input: ScheduleTaskInput,
  options: ScheduleTaskOptions = {}
): Promise<ScheduleTaskResult> {
  const overlapMode = options.overlapMode ?? "strict";
  // ...（原有验证逻辑不变）

  const conflictResult = await this.checkConflicts(input.startTime, input.endTime);
  const { warnings } = applyOverlapMode(conflictResult, overlapMode);
  // strict 时 applyOverlapMode 直接 throw ConflictError
  // warn 时 warnings 非空，继续执行

  const block = await this.blockRepo.create({ ... });
  await this.taskRepo.update(taskId, { status: "scheduled" });

  return { block, warnings };
}
```

**向后兼容说明**：现有调用方（`ScheduleTaskTool` 等）不传 `options` → 默认 `strict` → 行为不变，原有的 `throw new Error("时间冲突...")` 变为 `throw new ConflictError(...)`（继承 Error，catch 逻辑不受影响）。

### 4.2 TimeBlockService

```ts
// src/services/TimeBlockService.ts

export interface CreateTimeBlockOptions {
  /** 重叠模式，默认 "strict"（但 TimeBlockService 历史上不检测冲突） */
  overlapMode?: OverlapMode;
}

async createTimeBlock(
  input: CreateTimeBlockInput,
  options: CreateTimeBlockOptions = {}
): Promise<{ block: TimeBlock; warnings: ConflictSummary[] }> {
  const validated = CreateTimeBlockSchema.parse(input);
  const overlapMode = options.overlapMode ?? "strict";

  // V3.8: 新增冲突检测（历史上 TimeBlockService 没有检测）
  if (input.start_time && input.end_time) {
    const { start, end } = getDayRange(new Date(input.start_time));
    const existing = await this.repo.findByDateRange(start, end);
    const conflictResult = detectConflicts(existing, input.start_time, input.end_time);
    const { warnings } = applyOverlapMode(conflictResult, overlapMode);
    const block = await this.repo.create(validated);
    return { block, warnings };
  }

  const block = await this.repo.create(validated);
  return { block, warnings: [] };
}
```

**注意**：`createTimeBlock` 原有调用方均不依赖返回值结构的 `warnings` 字段（只关心 `block`），向后兼容。

---

## 5. 按 TimeBlock.type 差异化策略

| type | 推荐默认 overlapMode | 理由 |
|------|---------------------|------|
| `task` | `strict` | 任务块需严格避免重叠 |
| `event` | `strict` | 会议/事件需严格避免重叠 |
| `break` | `warn` | 休息可以和任务重叠（如弹性间隔） |
| `routine` | `warn` | 日常事务（早晨例程等）可以重叠 |

实施建议：在 `TimeBlockService.createTimeBlock` 内根据 `input.type` 自动推断 `overlapMode`（若调用方未显式传入）：

```ts
function inferDefaultOverlapMode(type?: TimeBlock["type"]): OverlapMode {
  if (type === "break" || type === "routine") return "warn";
  return "strict";
}
```

---

## 6. UI 层变更

### 6.1 ScheduleTaskDialog / TimeBlockForm

**warn 模式下**：
- 移除"检测到冲突 → 禁用提交"的强制阻止。
- 改为展示冲突警告列表，保留提交按钮。
- 提交前弹出二次确认对话框：

```
⚠️ 时间冲突
以下日程与新建时间块重叠：
• 14:00–15:00 「项目评审」
• 14:30–15:30 「客户电话」

是否确认继续创建？
[取消]  [确认创建]
```

### 6.2 冲突警告组件

```tsx
// src/components/schedule/ConflictWarningDialog.tsx（新建）
interface Props {
  conflicts: ConflictSummary[];
  onConfirm: () => void;
  onCancel: () => void;
}
```

### 6.3 AgentService.precheckPlanAction

Agent 路径**维持 strict**，不受 OverlapMode 配置影响：

```ts
// src/agent/AgentService.ts
private async precheckPlanAction(option: PlanOption): Promise<PlanPrecheckResult> {
  // Agent 自动排程始终使用 strict 模式
  // OverlapMode 仅影响用户手动操作路径，不影响 Agent
  // ...（不变）
}
```

---

## 7. 调用方影响矩阵

| 调用方 | 当前行为 | V3.8 行为 | 变更幅度 |
|--------|---------|-----------|---------|
| `ScheduleTaskTool.execute` | 调 `ScheduleService.scheduleTaskToTimeBlock`，catch Error | 同左，ConflictError 继承 Error，catch 不受影响 | 极小 |
| `CreateTimeBlockTool.execute` | 调 `TimeBlockService.createTimeBlock`，不检冲突 | 新增冲突检测，默认 strict | **有 breaking**（需同步更新 tool） |
| `ScheduleTaskDialog`（手动） | UI 禁用提交 | warn 模式下展示警告 + 二次确认 | 中等 |
| `TimeBlockForm`（手动） | UI 禁用提交 | 同上 | 中等 |
| `AgentService.precheckPlanAction` | strict throw | **不变**（始终 strict） | 无 |
| Agent 推荐路径 | 走空闲槽 | **不变** | 无 |

---

## 8. 影响文件汇总

| 文件 | 变更类型 |
|------|---------|
| `src/types/schedule.types.ts` | **新建**：`OverlapMode`、`OverlapCheckResult`、`ConflictSummary` |
| `src/lib/conflictDetector.ts` | + `applyOverlapMode()` / `ConflictError` |
| `src/services/ScheduleService.ts` | `scheduleTaskToTimeBlock` 增加 `options.overlapMode` 参数；返回类型加 `warnings` |
| `src/services/TimeBlockService.ts` | `createTimeBlock` 增加冲突检测 + `options.overlapMode`；返回类型加 `warnings` |
| `src/agent/tools/schedule/scheduleTaskTool.ts` | 处理 `ScheduleTaskResult.warnings`（非 breaking，但建议日志警告） |
| `src/agent/tools/timeblock/createTimeBlockTool.ts` | 处理新增的冲突检测（需传 `overlapMode: "warn"` 给用户提案路径） |
| `src/components/schedule/ScheduleTaskDialog.tsx` | warn 模式：移除强制禁用，展示警告 + 二次确认 |
| `src/components/schedule/TimeBlockForm.tsx` | 同上 |
| `src/components/schedule/ConflictWarningDialog.tsx` | **新建**：二次确认对话框组件 |

---

## 9. 测试矩阵（待实施时编写）

```
src/services/__tests__/ScheduleService.overlap.test.ts
  - overlapMode=strict + 有冲突 → throw ConflictError
  - overlapMode=warn + 有冲突 → 返回 { block, warnings: [冲突项] }，不抛错
  - overlapMode=allow_manual + 有冲突 → 返回 { block, warnings: [] }，写入成功
  - 无冲突（任意模式）→ 返回 { block, warnings: [] }

src/services/__tests__/TimeBlockService.overlap.test.ts
  - type="break" 默认 warn（type 推断）
  - type="task" 默认 strict
  - 显式传 overlapMode 覆盖类型推断

src/lib/__tests__/conflictDetector.overlap.test.ts
  - applyOverlapMode(strict, conflict) → throw ConflictError
  - applyOverlapMode(warn, conflict) → 返回 warnings
  - applyOverlapMode(allow_manual, conflict) → 返回空 warnings
```

---

## 10. 实施前置条件 & 风险点

1. **向后兼容**：`ScheduleService.scheduleTaskToTimeBlock` 的现有调用方（测试 + Agent tools）不传 `options` 时默认 `strict`，行为与当前完全一致。需核查 `ConflictError extends Error` 是否被现有 catch 块正确处理。
2. **`CreateTimeBlockTool` breaking change**：新增冲突检测后，原本绕过检测的路径会开始抛错。需在 tool 内决定默认 overlapMode（建议 `warn`，由用户二次确认）。
3. **Agent 路径隔离**：Agent `precheckPlanAction` 明确标注 `// Agent 路径始终 strict`，防止未来误用 `allow_manual`。
4. **UI 组件二次确认**：`ConflictWarningDialog` 需设计为非模态可关闭，避免阻塞 Heartbeat 反馈等并发 UI 流程。
5. **`OverlapMode` 全局设置**：本版本不实现，`defaultOverlapMode` 预留为后续用户设置入口。实施时应从 settingsStore 读取，注入到 `ScheduleService` / `TimeBlockService`。

---

*文档版本：V3.7 设计阶段 | 撰写日期：2026-05-30*
