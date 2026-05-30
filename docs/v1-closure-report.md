# V1 封板报告

> 文档版本：1.0  
> 生成日期：2026-05-14  
> 项目：time_manager（本地桌面端个人时间管理工具）  
> 报告阶段：V1 封板评审

---

## 1. V1 阶段目标

### V1 定位

V1 定位为 **Agent Tooling MVP**：在 V0 本地时间管理系统基础上，加入 Chat / Assistant 入口、规则化自然语言解析、Agent Tools、Tool Router / Executor、操作确认机制、Agent Action Log 和基础规则排程。

### V1 要解决的问题

- 用户可以通过自然语言输入（Chat UI）操作任务和时间块
- 系统能够解析中文指令，转为结构化意图（Intent）
- 通过 Tool 层调用已有 Service Layer 执行操作
- 所有 Agent 操作记录在 agent_action_logs 中
- 危险操作（删除、重排）需要用户确认后才执行
- 基础排程能力：自动查找空闲时间段安排任务
- 不接真实 LLM API，全部规则/正则/模板实现

### V1 明确不做

- 接入真实 LLM API（GPT / Claude / 本地模型）
- Heartbeat（心跳检测）
- 桌面宠物
- 云同步、多端同步
- 用户登录、账户系统
- 移动端
- 外部日历接入
- 长期记忆 / 用户画像
- 多轮复杂对话
- 语音输入

---

## 2. V1 核心能力完成情况

| 能力项 | 当前状态 | 证据模块 | 备注 |
|--------|----------|----------|------|
| Chat UI 页面 | 已完成 | `ChatPage`、`ChatPanel`、`ChatInput`、`ChatMessage` | 侧边栏有入口，可输入自然语言 |
| 自然语言意图解析 | 已完成 | `IntentParser` | 支持 12 种意图，中文关键词+正则 |
| Agent Service 协调器 | 已完成 | `AgentService` | 串联 Parser → Router → Tool → Log |
| Tool Router | 已完成 | `ToolRouter` | 17 个 Tool 注册与分发 |
| Task Tools (5个) | 已完成 | `createTaskTool` 等 | 创建/更新/删除/列表/标记完成 |
| TimeBlock Tools (5个) | 已完成 | `createTimeBlockTool` 等 | 创建/更新/删除/列表/绑定 |
| Schedule Tools (5个) | 已完成 | `scheduleTaskTool` 等 | 排期/重排/冲突检测/空闲槽/今日计划 |
| Explanation Tools (2个) | 已完成 | `explainTaskTool`、`explainScheduleTool` | 解释任务/排程 |
| 操作日志记录 | 已完成 | `ActionLogService`、`agent_action_logs` 表 | 每次请求和 Tool 调用均记录 |
| 对话持久化 | 已完成 | `SqliteConversationRepository`、`conversation_messages` 表 | 重启后对话历史恢复 |
| 确认机制 | 已完成 | `ConfirmationService`、`pending_confirmations` 表 | 删除/重排需确认，30s 超时自动过期 |
| 规则排程算法 | 已完成 | `scheduler.ts` | 空闲槽查找/优先级排序/整天重排 |
| 上下文代词解析 | 已完成 | `AgentService.resolveArgs` | "这个任务"→最近操作的任务 |
| V0 功能不受影响 | 已验证 | — | 所有 V0 功能正常 |

---

## 3. V1 最小演示流程验收

13 步端到端测试，全部通过：

| # | 操作 | 预期结果 | 状态 |
|---|------|----------|------|
| 1 | Chat 输入"明天下午帮我安排两个小时写数据挖掘报告" | 创建 Task + TimeBlock | ✅ 通过 |
| 2 | Todo List 和 Timeline 更新 | UI 反映新增 | ✅ 通过 |
| 3 | Chat 输入"我今天还有什么？" | 列出今日计划 | ✅ 通过 |
| 4 | Chat 输入"把写报告标记为完成" | Task 状态更新为 done | ✅ 通过 |
| 5 | Chat 输入"删除这个任务" | 系统要求确认 | ✅ 通过 |
| 6 | 用户点击"确认执行" | Task 被软删除，关联 TimeBlock 联动软删除 | ✅ 通过 |
| 7 | 用户点击"取消" | 不执行操作 | ✅ 通过 |
| 8 | 重启应用 | 数据状态正确 | ✅ 通过 |
| 9 | 检查 agent_action_logs | 有完整操作记录 | ✅ 通过 |
| 10 | 检查 conversation_messages | 对话历史正确保存 | ✅ 通过 |
| 11 | V0 Task CRUD | 正常工作 | ✅ 通过 |
| 12 | V0 TimeBlock CRUD + 排期 + 移回 | 正常工作 | ✅ 通过 |
| 13 | V0 冲突检测 | 正常工作 | ✅ 通过 |

---

## 4. V1 新增数据表

### agent_action_logs

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | UUID |
| user_input | TEXT NOT NULL | 用户原始输入 |
| detected_intent | TEXT | 识别到的意图 |
| tool_name | TEXT | 调用的工具名 |
| tool_args_json | TEXT | 工具参数 JSON |
| tool_result_json | TEXT | 工具返回结果 JSON |
| status | TEXT NOT NULL | pending/executing/success/failed/cancelled |
| error_message | TEXT | 错误信息 |
| created_at | TEXT NOT NULL | 创建时间 |

### conversation_messages

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | UUID |
| role | TEXT NOT NULL | user/assistant/system |
| content | TEXT NOT NULL | 消息内容 |
| metadata_json | TEXT | 元数据（如 confirmationId） |
| created_at | TEXT NOT NULL | 创建时间 |

### pending_confirmations

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | UUID |
| action_type | TEXT NOT NULL | 操作类型（intent 名） |
| tool_name | TEXT NOT NULL | 需执行的工具名 |
| tool_args_json | TEXT NOT NULL | 工具参数 |
| description | TEXT | 操作描述（展示给用户） |
| risk_level | TEXT NOT NULL | low/medium/high |
| status | TEXT NOT NULL | pending/confirmed/rejected/expired |
| created_at | TEXT NOT NULL | 创建时间 |
| expires_at | TEXT | 过期时间（默认 30s） |

---

## 5. 架构验证

### 硬性原则逐项检查

| 原则 | 结论 | 证据 |
|------|------|------|
| Agent / Parser / Tool 不允许直接写 SQL | ✅ 满足 | 所有 Tool 仅调用 Service Layer |
| Tool 只能调用 Service Layer | ✅ 满足 | Tool 代码中无 Repository 或 db 引用 |
| Service Layer 仍然是业务规则中心 | ✅ 满足 | Zod 校验、状态守卫、冲突检测仍在 Service |
| Chat UI 不能直接操作数据库 | ✅ 满足 | ChatStore → AgentService → Tool → Service |
| 每次 Agent 请求和 Tool 调用都记录日志 | ✅ 满足 | AgentService 中每步均调用 ActionLogService |
| 删除 Task/TimeBlock/重排必须确认 | ✅ 满足 | deleteTaskTool/deleteTimeBlockTool/rescheduleDayTool 均设 requiresConfirmation=true |
| 不破坏现有 Task / TimeBlock 模型 | ✅ 满足 | 类型和 Repository 未修改 |

### 完整链路验证

```
Chat UI → chatStore → AgentService → IntentParser → ToolRouter → Tool → Service → Repository → SQLite
                                                                   ↓
                                                          ActionLogService (日志)
                                                                   ↓
                                                          ConfirmationService (确认)
```

---

## 6. 已知限制

1. **IntentParser 覆盖有限**：纯规则匹配，复杂/模糊表达可能解析为 unknown
2. **无多轮上下文**：仅支持"这个任务"指向最近操作的任务，不支持复杂对话
3. **排程算法简单**：贪心策略按优先级顺序分配，无全局最优解
4. **Chat 操作后 Todo/Timeline 不自动刷新**：需手动切换页面触发数据重新加载
5. **确认超时为内存级**：确认过期依赖下次查询时检查，非后台定时器

---

## 7. V1 封板结论

### 结论：可以封板

V1 的核心目标（Agent Tooling MVP）已完整达成：

- Chat UI 入口可用
- 自然语言解析覆盖 12 种意图
- 17 个 Tool 全部实现并可调用
- 操作日志完整记录
- 确认机制正常工作
- 规则排程可用
- 13 步端到端测试全部通过
- V0 功能完全不受影响
- 不依赖任何外部 API 或云服务

---

## 8. 进入 V2 前建议

1. **补充 IntentParser 单元测试**：覆盖至少 30 个典型用例，确保后续迭代不破坏解析能力
2. **Chat 操作后自动刷新 Todo/Timeline**：通过 Store 订阅或事件总线实现跨页面数据同步
3. **引入真实 LLM**：替换 IntentParser 为 LLM 调用，提升理解能力
4. **丰富 NLG 回复模板**：当前回复较机械，可增加自然度
5. **考虑 Heartbeat 接入**：为 V2 "带心跳的 Agent" 做技术预研
