# Time Manager V2 — 封板候选报告

> 文档版本：1.0  
> 生成日期：2026-05-16  
> 项目版本：V2（Heartbeat 和执行反馈）

---

## 1. V2 目标回顾

V2 的目标是补上从"安排任务"到"执行任务"的反馈闭环：

```
TimeBlock scheduled
  ↓ 到开始前 → 提醒
  ↓ 到开始时间 → 开始提示
  ↓ 用户开始 → in_progress
  ↓ 到结束时间 → 反馈弹窗
  ↓ 用户反馈 → done / skipped / delayed
  ↓ Task 状态智能联动
```

---

## 2. 已完成内容

### V2.1 — HeartbeatService 纯逻辑层

- `src/types/heartbeat.types.ts`：`HeartbeatSettings`、`HeartbeatEvaluation`、`DEFAULT_HEARTBEAT_SETTINGS`
- `src/services/HeartbeatService.ts`：
  - `evaluateNow(blocks, now, settings)` — 综合评估，返回 4 个事件槽
  - `getCurrentFocus(blocks, now)` — 当前进行中 TimeBlock（优先 in_progress）
  - `getUpcomingReminder(blocks, now, settings)` — 开始前提醒（防重复）
  - `getStartPrompt(blocks, now)` — 开始提示（防重复）
  - `getPendingFeedback(blocks, now)` — 待反馈 TimeBlock（防重复）
  - `markReminderSent / markStartPromptSent / markEndPromptSent` — 写防重复时间戳
  - `startBlock / completeBlock / skipBlock / delayBlock` — 状态转换 + Task 联动

### V2.2 — DB Migration + 类型扩展 + Repository/Service 更新

- `src/db/migrations.ts`：新增 migration v4
  - PRAGMA foreign_keys OFF/ON 包裹重建过程
  - 重建 time_blocks 表，status CHECK 新增 `'delayed'`
  - 新增 8 个执行时间戳字段：`reminder_sent_at`、`start_prompt_sent_at`、`end_prompt_sent_at`、`started_at`、`completed_at`、`skipped_at`、`delayed_at`、`feedback_note`
  - 旧数据完整迁移，新字段全部初始化为 NULL
- `src/types/timeblock.types.ts`：
  - `TimeBlockStatus` 新增 `"delayed"`
  - `TimeBlock` 接口新增 8 个可选字段
  - `UpdateTimeBlockSchema` 新增 8 个可选字段（Zod schema）
- `src/repositories/sqlite/SqliteTimeBlockRepository.ts`：`rowToTimeBlock` 映射新字段，`update` 方法动态处理新字段
- `src/services/TimeBlockService.ts`：新增 `updateExecutionState`（穿透 is_locked 的执行专用更新）
- `src/services/TaskService.ts`：新增 `getFutureActiveBlocksCount`（Task 联动判断辅助）
- `src/components/shared/StatusBadge.tsx`：新增 `delayed` 状态配置

### V2.3 — heartbeatStore + TodayPage 接入

- `src/store/heartbeatStore.ts`：
  - Zustand persist（localStorage key: `heartbeat-settings`）持久化设置字段
  - 运行时状态（currentFocusBlock 等）不持久化
  - `startHeartbeat / stopHeartbeat` 防重复 interval 管理
  - `tick()` 主循环：加载今日 blocks → evaluateNow → 更新状态 → 写防重复时间戳 → 条件弹对话框
  - `startBlock / completeBlock / skipBlock / delayBlock` — 调用 HeartbeatService 后刷新 tick
- `src/pages/TodayPage.tsx`：接入 `startHeartbeat / stopHeartbeat`（useEffect 生命周期管理）

### V2.4 — UI 组件

- `src/components/heartbeat/HeartbeatPanel.tsx`：
  - Heartbeat 关闭时显示最小化开关条
  - 开启时显示状态行（最后检查时间）+ CurrentFocusCard + 即将开始提醒
- `src/components/heartbeat/CurrentFocusCard.tsx`：
  - 当前焦点 TimeBlock 展示（标题、时间范围）
  - in_progress 状态：amber 高亮 + 脉冲动画
  - 操作按钮：开始（scheduled 状态显示）/ 完成 / 跳过 / 延迟
- `src/components/heartbeat/ExecutionFeedbackDialog.tsx`：
  - Radix Dialog，当 `isFeedbackDialogOpen && pendingFeedbackBlock` 时渲染
  - 展示 TimeBlock 信息 + 可选备注 + Done / Skip / Delay 三按钮
  - 防重复：弹出前已写入 `end_prompt_sent_at`，下次 evaluateNow 不再返回该 block
- `src/components/timeline/TimeBlockCard.tsx`：
  - `in_progress`：amber 边框 + 脉冲左色条 + ▶ 标识，zIndex 提升
  - `delayed`：橙红色调 + 虚线边框 + 延迟标识（区别于灰色的 skipped）
  - `done / skipped / cancelled`：50% 透明度
  - 新增 Delay 菜单项（走简单 `updateBlockStatus` 路径，不含 Task 联动）

### V2.5 — SettingsPage + 封板

- `src/pages/SettingsPage.tsx`：新增 Heartbeat 设置区（开关、提前提醒分钟、检查间隔、自动弹出反馈）
- 所有设置通过 `updateSettings` 写入 Zustand persist → localStorage

---

## 3. 技术设计决策说明

| 决策 | 说明 |
|---|---|
| Heartbeat 不接入 ActionLogService | V2 首版不记录 Heartbeat 操作日志，避免额外复杂度。V3 可接入 |
| Delay 不自动重排 | 符合 V2 边界，只标记状态并提示用户，V3 才做智能重排 |
| TimeBlockCard 的 Delay 菜单不含 Task 联动 | 走 `updateBlockStatus` 简单路径；完整联动逻辑在 HeartbeatService 中，通过 Heartbeat UI 路径触发 |
| heartbeatIntervalSeconds 变更需重启 Heartbeat | timer 创建时已固化间隔时间，更改后需关闭再开启。Settings 页有提示 |
| getFutureActiveBlocksCount 不新增 Repository 方法 | 在 TaskService 中过滤已有 findByTaskId 结果，避免接口膨胀 |

---

## 4. 回归测试清单

### V0 回归

- [ ] 应用可以启动，SQLite migration v4 正常执行
- [ ] 旧 time_blocks 数据迁移后完整，新字段全部为 NULL
- [ ] Todo CRUD 正常
- [ ] TimeBlock CRUD 正常
- [ ] Task 排期正常（scheduled 后 Task 状态变更）
- [ ] 一个 Task 可以有多个 TimeBlock
- [ ] TimeBlock 移回 Todo 正常
- [ ] 时间冲突检测正常
- [ ] 删除 Task 联动 TimeBlock 软删除正常
- [ ] 空 Todo / 空 Timeline 不崩溃

### V1 回归

- [ ] Chat 页面正常加载
- [ ] 输入"帮我安排两小时写报告"，Task 创建正常
- [ ] TimeBlock 建议正常
- [ ] Todo List / Timeline 正常更新
- [ ] 输入"我今天还有什么"，返回今日计划
- [ ] 输入"标记完成"，Task 状态更新
- [ ] 输入"删除这个任务"，触发确认机制
- [ ] 确认后软删除，关联 TimeBlock 联动删除
- [ ] agent_action_logs 有记录
- [ ] conversation_messages 有记录
- [ ] pending_confirmations 正常工作

### V2 验收

- [ ] Heartbeat 可以开启 / 关闭（设置持久化，重启后恢复）
- [ ] HeartbeatPanel 在 TodayPage 正常显示
- [ ] 开启 Heartbeat 后定时 tick 执行
- [ ] 可以识别即将开始的 TimeBlock（开始前 N 分钟）
- [ ] 开始前提醒不会重复（reminder_sent_at 写入后不再触发）
- [ ] 到开始时间后 HeartbeatPanel 出现 CurrentFocusCard
- [ ] 点击"开始"后 TimeBlock 变为 in_progress，绑定 Task 变为 in_progress
- [ ] 到结束时间后弹出 ExecutionFeedbackDialog
- [ ] 结束反馈不会重复弹出（end_prompt_sent_at 防重复）
- [ ] Done 后 TimeBlock → done；单 TimeBlock Task → done；多 TimeBlock Task → scheduled
- [ ] Skip 后 TimeBlock → skipped；无其他未来块 Task → todo；有未来块 Task → scheduled
- [ ] Delay 后 TimeBlock → delayed；无其他未来块 Task → todo；有未来块 Task → scheduled
- [ ] Delay 不自动重排，UI 提示可稍后重新安排
- [ ] TimeBlockCard 中 delayed 状态有明显区别于 skipped 的视觉样式（橙色虚线 vs 灰色透明）
- [ ] TimeBlockCard 中 in_progress 状态有明显高亮（amber + 脉冲）
- [ ] SettingsPage 可调整提前提醒分钟数和检查间隔
- [ ] 重启应用后 Heartbeat 设置保持，运行时状态正确重新评估
- [ ] UI 不直接访问数据库，Heartbeat 不绕过 Service Layer

---

## 5. 已知限制

1. **Heartbeat 操作不记录 ActionLog**：V2 的 Done/Skip/Delay 操作不写入 `agent_action_logs`，无法在 Agent 历史中追溯。V3 可补充。
2. **更改检查间隔需重开 Heartbeat**：当前 interval 创建后固化间隔，修改 `heartbeatIntervalSeconds` 后需在设置页关闭再开启 Heartbeat 才生效。Settings 页有提示说明。
3. **TimeBlockCard 的 Delay 菜单不含 Task 联动**：通过菜单直接标记 delayed 只调用 `updateBlockStatus`，不触发 Task 状态联动。完整联动仅在 Heartbeat 路径（CurrentFocusCard / FeedbackDialog）中生效。
4. **没有桌面通知**：提醒和开始提示仅在应用界面内展示（HeartbeatPanel），不推送系统桌面通知。V3 可通过 Tauri notification 插件补充。
5. **多日 TimeBlock 不处理**：Heartbeat tick 只加载当日 TimeBlock，跨日的 TimeBlock（如凌晨场景）不在当前评估范围内。

---

## 6. 回滚方案

### 代码回滚

```bash
git revert adae29d
```

### 数据库降级

若需回滚已运行的数据库（谨慎操作）：

```sql
-- 方案一：删除 v4 记录，下次启动将重新运行 v4
-- 仅在旧版代码无法识别 delayed 数据时需要
DELETE FROM schema_version WHERE version = 4;

-- 方案二（更稳健）：在运行 v4 migration 前备份 .db 文件
-- 路径：%APPDATA%\com.time-manager\time_manager.db（Windows）
-- 回滚时直接替换数据库文件
```

---

## 7. 下一阶段（V3 预告）

V3 目标：真正 Agent 化排程

- 接入真实 LLM API（OpenAI / 本地模型）
- Heartbeat 操作接入 ActionLogService
- Delay 后智能提示重排方案（由 LLM 生成建议）
- 桌面通知（Tauri notification 插件）
- 更完整的执行分析（今日完成率、延迟率等）
