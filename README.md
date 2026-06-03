# Time Manager

> 本地优先的桌面时间管理应用。当前主线不是早期 V0 原型，而是已经完成本地任务/日程闭环、Heartbeat 执行反馈、Agent Tool Contract、LLM-first 安全规划链路，并正在把 RAG / Memory / 外部上下文能力纳入后续产品化设计。

**当前快照**：2026-05-31  
**产品主线状态**：Product V2.5 Done + V3.7 Integration Freeze Done  
**Agent 子线状态**：Agent Track V5 Mock-First Done，部分 V3.7 P1 routing / UX hotfix 已落到代码  
**下一阶段建议**：Product V4 Import Foundation -> Product V5 Production Memory -> Product V6 Plan Mode

---

## 1. 当前定位

Time Manager 的核心不是单纯 todo list，而是一个围绕“任务、时间块、执行反馈、Agent 协助”的本地时间操作系统：

```text
Task / Todo
  -> Schedule / TimeBlock
  -> Timeline
  -> Heartbeat execution feedback
  -> Agent proposal / confirmation
  -> ActionLog / Trace
```

当前已具备：

- 本地 SQLite 持久化，默认不依赖云端账号。
- Todo / Timeline / Chat / Settings 基础 UI。
- 任务创建、安排、调整、完成、删除、移回 Todo。
- Heartbeat 主动执行提醒与结束反馈。
- Agent Chat 入口，支持 time management、普通聊天、知识问答、写作辅助、外部信息、反馈、低信号输入等 domain。
- DeepSeek LLM-first planner，可在缺 key 或关闭时降级到规则路径。
- ToolRouter + ConfirmationPolicy + PlanSafetyValidator 安全边界。
- ConversationService 解耦，chatStore 不再直连 SQLite repository。
- Mock-first Memory / RAG / Notification 适配器与 RecommendationHandler。
- 独立 `v3-external-context-plugin`，用于把网页、微信、本地导出、企业微信等来源整理为 Agent 可消费的 `ExternalContext` JSON。

---

## 2. 版本语义

后续文档统一区分两条线，避免把 Agent 内部版本误读成产品整体版本：

| 线 | 含义 | 当前状态 |
|---|---|---|
| Product Version | 面向用户可用能力的产品主线 | Product V2.5 已完成，V3.7 已完成集成冻结 |
| Agent Track Version | Agent 内部规划、路由、mock-first 能力 | Agent V5 mock-first 已完成 |

当前判断：

```text
Product V0: 本地任务/日程闭环 Done
Product V1: 规则排程 Partial
Product V2: Heartbeat + 执行反馈 Done
Product V2.5: Agent Tool Contract Done
Product V3.7: Integration Freeze Done

Agent V3-V5: LLM / 多日程 / 推荐 / mock memory-RAG 已提前验证
Product V4: Import Foundation 未开始
Product V5: Production Memory 待产品化
Product V6: Plan Mode / Planning RAG 待启动
```

参考文档：

- `docs/ROADMAP_REBASE_AFTER_AGENT_V5.md`
- `docs/V3.7/V3.7_IMPLEMENTATION_PLAN.md`
- `docs/V3.7/V3.7_CLOSURE_REPORT.md`
- `.cursor/plans/v3.7_routing_&_ux_hotfix_audit_9bcf727c.plan.md`

---

## 3. 技术栈

| 层级 | 技术 |
|---|---|
| 桌面壳 | Tauri 2.x |
| 前端 | React 19 + TypeScript |
| 构建 | Vite 6 |
| 状态管理 | Zustand |
| 本地数据库 | SQLite via `@tauri-apps/plugin-sql` |
| UI | Tailwind CSS v4 + Radix UI + lucide-react + sonner |
| 日期 | date-fns |
| 校验 | zod |
| 测试 | Vitest |
| LLM | DeepSeek OpenAI-compatible API，通过 `LLMClient` 抽象隔离 |
| 外部上下文插件 | Node.js 18+，可选 Python / opencli / wx-cli / wecom-cli |

---

## 4. 快速开始

环境要求：

```text
Node.js >= 18
pnpm
Rust + MSVC Build Tools
```

安装依赖：

```powershell
pnpm install
```

启动前端：

```powershell
pnpm dev
```

启动 Tauri 桌面端：

```powershell
pnpm tauri dev
```

类型检查与测试：

```powershell
pnpm exec tsc --noEmit
pnpm test
```

构建：

```powershell
pnpm build
pnpm tauri build
```

LLM 配置见 `.env.example`。关键行为：

- `VITE_LLM_AGENT_ENABLED=true` 且配置 `VITE_DEEPSEEK_API_KEY`：time management 走 LLM-first planner。
- 未配置 key、LLM 不可用或显式关闭：应用正常启动，自动降级到规则路径。

---

## 5. 架构总览

```text
React UI
  AppLayout / TodayPage / ChatPage / SettingsPage
  Todo / Timeline / Heartbeat / Chat components

Zustand Store
  taskStore / timeBlockStore / heartbeatStore / chatStore / uiStore

Service Layer
  TaskService / TimeBlockService / ScheduleService
  HeartbeatService / ConversationService / ConfirmationService / ActionLogService

Repository Layer
  ITaskRepository / ITimeBlockRepository / IConversationRepository
  IConfirmationRepository / IActionLogRepository
  SQLite implementations

Agent Layer
  AgentService
  DomainRoutingService
  TimeManagementAgent
  ToolRouter
  LLMExperiencePlanner / CompositePlanner / ActionPlanner
  PlanSafetyValidator / ConfirmationPolicy
  MemoryAdapter / RagAdapter / NotificationAdapter

Tauri + SQLite
  @tauri-apps/plugin-sql
  local sqlite database
```

核心原则：

- UI 不写 SQL。
- 写 Task / TimeBlock 的 Agent 操作必须走 ToolRouter / Tool / Service。
- LLM 不直接访问数据库，不直接调用 Service。
- 任何危险写操作必须进入 confirmation。
- 只读 handler 不引用 ToolRouter。
- 行为必须可追踪到 ActionLog / AgentTrace。

---

## 6. Agent 工作流

### 6.1 总入口

`AgentService.processInput(userInput, context)` 是 Chat 侧主入口。

简化流程：

```text
user input
  -> DomainRoutingService
  -> domain dispatch
  -> handler or TimeManagementAgent
  -> response boundary
  -> metadata / ActionLog / AgentTrace
```

### 6.2 DomainRoutingService 三段式路由

当前代码已存在 V3.7 P1 三段式路由：

```text
ContextualPreRouter
  -> LLMDomainClassifier
  -> AgentDomainRouter fallback
```

职责：

- `ContextualPreRouter`：处理高确定性上下文，例如 pending confirmation 下用户说“好 / ok / 确认 / 取消”。
- `LLMDomainClassifier`：仅做 domain 分类，严格 JSON schema，不允许生成工具调用。
- `AgentDomainRouter`：LLM disabled、不可用、低置信、非法输出时的规则兜底。

当前 8 个 domain：

| domain | 用途 | 写权限 |
|---|---|---|
| `time_management` | 创建、安排、查询、调整、删除任务/时间块 | 是，必须走 ToolRouter |
| `assistant_meta` | 询问身份、模型、能力、应用帮助 | 否 |
| `general_chat` | 普通聊天 | 否 |
| `knowledge_qa` | 知识问答 | 否 |
| `writing_assistant` | 写作辅助 | 否 |
| `external_info` | 天气、外部信息等入口占位 | 否 |
| `feedback_or_complaint` | 用户反馈/吐槽 | 否 |
| `low_signal` | 空输入、纯标点、无上下文短词 | 否 |

### 6.3 time_management 主链路

```text
SemanticFrameParser
  -> CompositePlanner
       -> LLMExperiencePlanner first
       -> ActionPlanner fallback
  -> PlanSafetyValidator
  -> ConfirmationPolicy
  -> ToolRouter
  -> Service
  -> Repository
```

LLM 只能输出结构化 `ExperienceActionPlan`。所有计划都要经过：

```text
schema validation
  -> toolName whitelist
  -> args validation
  -> PlanSafetyValidator
  -> ConfirmationPolicy
  -> ToolRouter
```

### 6.4 confirmation / batch / defer

V3.7 已修复 batch / defer “确认后不执行”的问题：

- `ActionPlanner` 会把 batch delete / defer 分解成 `actions[]`。
- `AgentService.confirmAction()` 检测到 `actions[]` 后顺序执行。
- 任一步失败会 short-circuit。
- 每步写 ActionLog。

### 6.5 只读 LLM handler

`general_chat`、`knowledge_qa`、`writing_assistant` 可使用 `LLMChatExecutor` 生成文本回复，但它们：

- 不走 ToolRouter。
- 不写 Task / TimeBlock。
- 不绕过 confirmation。
- LLM 不可用时回到边界回复。

---

## 7. Heartbeat 工作流

Heartbeat 是执行反馈引擎，不是隐藏的 Agent 大脑。

当前能力：

- 当前专注时间块展示。
- 到点开始 / 结束反馈。
- 延长、延后、拆分剩余任务。
- 延后后的重新安排建议。
- 结束反馈的 snooze 已持久化到 `time_blocks.feedback_snoozed_until`。
- “暂不处理”后 10 分钟内不会反复弹窗。

V3.7 P0 hotfix 已覆盖：

- Confirmation 按钮残留修复。
- Heartbeat snooze 持久化。
- 自动推荐时间不再默认回到当天 08:00，而是使用 `now + buffer`。

---

## 8. Memory / RAG 现状

当前 Memory 与 RAG 已经分化：

- **Memory** 仍是 mock-first 骨架，等待 ProductionMemoryAdapter。
- **RAG** 已进入 V3.8 / … / V3.8.6 Scaffold / **V3.8.7 Production Pack**（可配置 embedding、VectorStoreFactory、ScoreReranker、Eval dataset、Admin UI）。Chat 默认 V3.8.3 legacy；`VITE_RAG_ENGINE=self_hosted` 启用自建栈；`VITE_ENABLE_RAG_ADMIN=true` 显示引擎管理 Tab。
- V3.8.3 `DeterministicEmbeddingProvider` + `rag_embeddings` 仅作 **dev fallback**，不是生产向量方案。
- **正式部署策略（V3.8.4）**：**自建 Self-hosted RAG Engine**；Coze Dataset 路线已废弃为正式核心（V3.8.2 仅保留演示）。详见 `docs/V3.8/V3.8.4_SELF_HOSTED_RAG_ENGINE_PLAN.md`。V3.9 留给真向量库 / 多模型 / Reranker 封板。

### Memory 当前能做什么

`src/agent/memory/MemoryAdapter.ts` 定义了行为记忆接口，`MockMemoryAdapter` 用于测试。

当前职责更接近“用户行为统计与偏好摘要”：

- 记录或读取近期任务完成/排程行为。
- 为 `RecommendationHandler` 提供“用户最近习惯”的参考。
- 支持后验统计思路，不要求所有偏好实时计算。
- 目前不自动修改 RAG，不作为长期知识库写入器。

适合后续扩展：

- 完成率、拖延率、常用工作时段、任务类别偏好。
- 计划与实际执行偏差。
- recall / 近义联想 / 任务别名。
- 面向 LLM 的个人行为指导标准，例如“这个用户下午更适合轻任务”。

### RAG 当前能做什么

RAG 当前是 **SQLite hybrid RAG**：Chat 主路径为 vector + keyword fallback；管理 UI 检索预览仍为 keyword 调试。

已落地：

- `rag_documents / rag_chunks` 实表。
- `RagService.ingestDocument / retrieve / listDocuments / deleteDocument`。
- `SqliteRagAdapter` 接入 `RecommendationHandler`（V3.8.3 注入 `VectorRagService` hybrid）。
- `rag_embeddings`（migration v8）+ App 启动 `embedMissingChunks()`。
- `DeterministicEmbeddingProvider`：chunk/query 嵌入 + 内存 cosine topK。
- 5 条 `seed_knowledge` 时间管理理论，App 启动时幂等写入。
- Chat 主路径默认只检索 `seed_knowledge`。
- Settings 中有 `user_material` 进入 Chat 的总开关。
- `user_material` 进入 Chat 需要双门控：全局 toggle ON 且文档 `status='active'`。
- `RagIngestionService` 管资料生命周期：`draft / active / archived`。
- `external_context` 经 UI 写入强制 `draft`。
- `system_guidance / memory_summary` 不允许 UI 写入，留给系统内部或未来 Memory 管线。
- RAG 建议进入用户可见回复前会经过 `sanitizeRecommendation`。

当前仍不做：

- 不接 sqlite-vec / pgvector 等大型向量库。
- 生产路径默认不调用 OpenAI embedding API（草案类可显式启用）。
- 暂不直接参与主排程写入。
- 暂不让 RAG 结果直接生成 ToolRouter action。

知识库维护入口：

- `VITE_ENABLE_RAG_ADMIN=true` 时，Settings 显示“知识库管理器”。
- false 或未设置时隐藏该维护入口，适合语料灌入完成后封藏。
- 隐藏入口不影响已 active 的知识被检索。

V3.8.2 Demo Library（`VITE_ENABLE_RAG_ADMIN=true` 时 Dialog 内 Tab）：

- **统计**：文档/chunk 数量与 sourceType 分布。
- **检索预览**：本地 **keyword** 命中预览（仅 active）；Chat 主路径已 vector/hybrid，本 Tab 用于调试。
- **导出预览**：生成 Coze-like Dataset JSON 形态，**不调用 Coze API**。

适合放入：

- 时间管理研究：艾宾浩斯、间隔重复、深度工作、碎片时间利用、考试复习策略。
- 用户导入资料：课程安排、讲座、比赛、学校通知。
- 外部上下文插件生成的 brief。

### Memory 和 RAG 的边界

推荐理解：

```text
Memory = 用户自己的行为偏好与历史执行规律
RAG    = 可检索的外部知识、历史材料、通知内容、理论依据
Agent  = 把 Memory + RAG + 当前任务上下文合成 proposal
```

Memory 不应随意改 RAG。更稳妥的方向是：

- Memory 生成用户偏好摘要。
- RAG 提供人工维护资料、用户材料、外部材料和理论片段。
- Agent 在 proposal 阶段同时引用二者。
- 用户确认后才写 Task / TimeBlock。
- 后台可周期性从 ActionLog / Task / TimeBlock 做后验统计，更新 Memory 摘要。
- 未来 Memory -> RAG 的 `memory_summary` 转化必须走独立系统路径，不走普通 UI。

---

## 9. 外部上下文插件

`v3-external-context-plugin/` 是从 V3 摘出的独立插件，不依赖 Tauri UI，用于把外部来源整理成稳定 JSON：

```text
web / wx / wecom / user export
  -> raw context
  -> ExternalContext JSON
  -> agent brief
  -> future RAG / Agent input
```

快速使用：

```powershell
cd v3-external-context-plugin
.\start.ps1 help
.\start.ps1 doctor
.\start.ps1 list
```

自然命令助手：

```powershell
python assistant.py
python assistant.py wx sessions 5条 存档
python assistant.py wx history 方顾涵 大数据2班 30条 存档
python assistant.py wx search 会议 in 示例项目群 20条 存档
python assistant.py web https://example.com 存档
```

定向回顾 workflow：

```powershell
python review.py dry-run
python review.py once
python review.py once --all
python review.py once --id example-private-chat --dry-run
```

风险边界：

- 插件不会自动运行 `wx init --force`。
- 不会自动全局搜索。
- 不会自动读取所有会话。
- 默认只处理 `watchlist.json` 中 `enabled: true` 的来源。
- 微信本地读取依赖 wx-cli，属于实验能力；演示优先使用已保存 JSON 或用户主动导出文件。

---

## 10. 数据库 Schema 摘要

当前迁移版本到 v7。

主要表：

| 表 | 用途 |
|---|---|
| `tasks` | 任务 / Todo |
| `time_blocks` | 时间块 / Timeline / Heartbeat |
| `agent_action_logs` | Agent 行为审计 |
| `conversation_messages` | Chat 消息与 metadata |
| `pending_confirmations` | 待确认写操作 |
| `rag_documents` | RAG 文档元数据、sourceType、status、trustLevel |
| `rag_chunks` | RAG 文档切片，供 keyword retrieve 使用 |
| `schema_version` | migration 版本 |

`time_blocks` 已包含执行反馈字段：

```text
reminder_sent_at
start_prompt_sent_at
end_prompt_sent_at
started_at
completed_at
skipped_at
delayed_at
feedback_note
feedback_snoozed_until
```

RAG 文档治理字段：

```text
source_type
status: draft / active / archived
trust_level: low / medium / high
reviewed_at
deleted_at
```

---

## 11. 目录导航

```text
src/
  agent/
    AgentService.ts
    ToolRouter.ts
    CompositePlanner.ts
    experience/
    handlers/
    llm/
    memory/
    notification/
    router/
    skills/
    time-management/
    tools/
    validators/
    testing/
  components/
    chat/
    heartbeat/
    layout/
    schedule/
    shared/
    timeline/
    todo/
  db/
  lib/
  pages/
  repositories/
  services/
  store/
  types/

docs/
  ROADMAP_REBASE_AFTER_AGENT_V5.md
  V3.7/
  V3.6/
  V3/
  V2.5/
  later/
  5.30_code_check/

v3-external-context-plugin/
  README.md
  assistant.py
  review.py
  watchlist.json
  src/
  outputs/
```

---

## 12. 验收门禁

常规变更后至少运行：

```powershell
pnpm exec tsc --noEmit
pnpm test
```

涉及 Tauri / Rust：

```powershell
cd src-tauri
cargo check
```

涉及外部上下文插件：

```powershell
cd v3-external-context-plugin
.\start.ps1 doctor
python review.py dry-run
```

关键手测：

1. 创建任务并安排到日程，Timeline 正常显示。
2. 删除或批量操作必须出现确认，确认后不残留旧按钮。
3. Heartbeat 结束反馈点“暂不处理”后 10 分钟内不重复弹。
4. 当前时间后发起“安排 30 分钟任务”，推荐时间不早于 `now + buffer`。
5. 关闭 LLM 或缺 API key 时，Chat 不崩溃并回到规则路径。

---

## 13. 下一步路线

推荐顺序：

1. **V3.8.x RAG Foundation**：V3.8.7 Production Pack（embedding/vector/rerank 工厂、reindex 增强、评测集、Admin UI）；V3.8.6 骨架；`VITE_RAG_ENGINE=self_hosted`；`VITE_RAG_EMBEDDING_PROVIDER` / `VITE_RAG_RERANKER` 可选；`VITE_ENABLE_RAG_ADMIN=true` 打开知识库 + 引擎管理。
2. **Product V4 Import Foundation**：先做粘贴文本 / ICS / CSV 导入，生成可编辑 proposal，不直接写 Timeline。
3. **Product V5 Production Memory**：把 mock memory 换成本地生产适配器，基于 ActionLog / Task / TimeBlock 做后验统计。
4. **Memory 指导标准**：沉淀面向 LLM 的用户偏好摘要与排期准则，而不是只给统计数字。
5. **V3.9 真向量库 / 多模型 / Reranker（封板）**：在 V3.8.3 最小向量管线稳定后，再接 sqlite-vec / pgvector、生产 embedding、复杂 hybrid 融合与 rerank。
6. **Product V6 Plan Mode**：多步骤计划先生成 proposal，用户编辑确认后再执行。
7. **Product V7 Local Workspace Agent**：只读本地 workspace 索引，权限边界独立于 Time Manager 数据。
8. **Product V8 Executor Plugin System**：把内置 ToolRouter 演进为插件式 executor，但继续保留 ConfirmationPolicy 和审计。

不建议现在直接做：

- 真实向量库大规模接入。
- OCR 结果直接写数据库。
- LangGraph 式 autonomous workflow。
- 让外部消息读取器默认自动扫全量会话。
- 让 Memory 自动改写 RAG 或越过用户确认写日程。
