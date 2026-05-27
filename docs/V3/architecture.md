# Time Manager V3 — 代码架构说明

> 文档版本：1.0  
> 生成日期：2026-05-19  
> 项目版本：V3（DeepSeek LLM Agent 接入版）

---

## 一、版本定位

V3 在 V2.5 的 Agent Tool Contract 基础设施上，把 IntentParser 从纯正则规则升级为
**"LLM 结构化解析 + 工具计划生成"**。用户自然语言输入经过 DeepSeek LLM 解析后，
生成结构化 `AgentActionPlan`，再由 V2.5 已有的 ToolRouter → Tool → Service → SQLite
管道安全执行。

核心升级：
- 新增 `src/agent/llm/` LLM Adapter 层（4 个文件）
- 新增 `src/agent/LLMPlanner.ts` 核心解析胶水层
- `AgentService` 扩展为双路径（LLM 路径 + 规则 fallback 路径）
- `ChatMessageMetadata` 扩展 LLM 相关字段
- `ChatMessage.tsx` 展示 LLM 来源标记和响应类型

不改动：
- 17 个 Tool 文件
- 所有 Repository / Service（ActionLog、Confirmation、Task 等）
- DB Schema / migrations
- Heartbeat 相关代码
- V0/V1/V2/V2.5 已封板功能

---

## 二、整体目录结构

```
src/
├── agent/                        # Agent 系统（V1~V3 逐步构建）
│   ├── llm/                      # V3 新增：LLM Adapter 层
│   │   ├── LLMClient.ts          # 统一 LLM 接口定义（接口隔离）
│   │   ├── DeepSeekClient.ts     # DeepSeek API 实现（fetch）
│   │   ├── schemas.ts            # LLM 输出 Zod schema + 解析工具
│   │   ├── prompts.ts            # System prompt + 上下文块格式化
│   │   └── contextBuilder.ts    # 今日任务/时间块/消息上下文构造
│   ├── tools/                    # 17 个工具实现（V1/V2.5 已完成，V3 未改）
│   │   ├── task/                 # 5 个任务工具
│   │   ├── timeblock/            # 5 个时间块工具
│   │   ├── schedule/             # 5 个排程工具
│   │   ├── explain/              # 2 个解释工具
│   │   └── BaseTool.ts           # 工具基类（含 requireParam 辅助）
│   ├── AgentService.ts           # V3 改造：双路径协调器
│   ├── LLMPlanner.ts             # V3 新增：LLM 解析核心胶水层
│   ├── IntentParser.ts           # 规则 NLU（V3 fallback 保留）
│   ├── ToolRouter.ts             # 工具注册表 + 路由执行器
│   └── types.ts                  # Agent 层所有类型契约（V3 扩展）
│
├── components/
│   ├── chat/
│   │   ├── ChatMessage.tsx       # V3 改造：支持 LLM 标记和响应类型样式
│   │   ├── ChatPanel.tsx         # 消息列表 + 历史加载（未改）
│   │   └── ChatInput.tsx         # 输入框（未改）
│   ├── heartbeat/                # Heartbeat UI（未改）
│   ├── timeline/                 # 时间轴 UI（未改）
│   ├── todo/                     # Todo UI（未改）
│   ├── schedule/                 # 排程对话框（未改）
│   ├── shared/                   # 共享组件（未改）
│   └── layout/                   # 布局组件（未改）
│
├── pages/
│   ├── TodayPage.tsx             # 今日页（未改）
│   ├── ChatPage.tsx              # Chat 页（未改）
│   └── SettingsPage.tsx          # 设置页（未改）
│
├── store/
│   ├── chatStore.ts              # V3 改造：传递上下文给 AgentService
│   ├── taskStore.ts              # Task 状态（未改）
│   ├── timeBlockStore.ts         # TimeBlock 状态（未改）
│   ├── heartbeatStore.ts         # Heartbeat 状态（未改）
│   └── uiStore.ts                # UI 页面切换（未改）
│
├── services/                     # 业务服务层（V3 未改）
│   ├── TaskService.ts
│   ├── TimeBlockService.ts
│   ├── HeartbeatService.ts
│   ├── ScheduleService.ts
│   ├── ActionLogService.ts
│   └── ConfirmationService.ts
│
├── repositories/                 # 数据访问层（V3 未改）
│   ├── interfaces/               # 4 个 Repository 接口定义
│   └── sqlite/                   # SQLite 实现
│
├── types/                        # 全局持久化类型
│   ├── task.types.ts
│   ├── timeblock.types.ts
│   ├── heartbeat.types.ts
│   └── agent.types.ts            # ActionLog / PendingConfirmation DB 实体
│
├── db/
│   ├── client.ts                 # SQLite 连接单例
│   └── migrations.ts             # 数据库迁移（v1~v4，V3 无新增）
│
├── lib/
│   ├── utils.ts                  # Tailwind 工具函数
│   ├── dateUtils.ts              # 日期工具
│   ├── scheduler.ts              # 排程算法
│   └── conflictDetector.ts       # 时间冲突检测
│
├── App.tsx                       # 应用入口（runMigrations → AppLayout）
├── main.tsx                      # React 挂载点
└── vite-env.d.ts                 # V3 新增：Vite import.meta.env 类型声明
```

---

## 三、V3 新增/修改文件详细说明

### 3.1 `src/agent/llm/LLMClient.ts` — 统一 LLM 接口

**性质**：新增  
**职责**：定义所有 LLM 客户端必须实现的接口，隔离上层代码与具体 HTTP 实现。

**导出内容**：

| 名称 | 类型 | 说明 |
|---|---|---|
| `LLMMessage` | interface | `{role, content}` 对话消息 |
| `LLMChatOptions` | interface | `temperature`, `maxTokens` |
| `LLMChatResponse` | interface | `{content, usage?}` |
| `LLMErrorKind` | type | `api_key_missing` \| `network_error` \| `http_error` \| `parse_error` \| `unknown` |
| `LLMError` | class | extends Error，携带 `kind` 和可选 `statusCode` |
| `LLMClient` | interface | `chat()` + `isAvailable()` + `getModelName()` |

**关键设计**：
- `AgentService` 和 `LLMPlanner` 只依赖此接口
- V3.1 切换为 `@tauri-apps/plugin-http` 时只需新建实现类，上层零改动

---

### 3.2 `src/agent/llm/DeepSeekClient.ts` — DeepSeek 实现

**性质**：新增  
**职责**：实现 `LLMClient` 接口，使用浏览器原生 `fetch` 调用 DeepSeek Chat Completions API。

**配置读取**（每次调用时重新读取，支持运行时热更新）：

| 环境变量 | 默认值 |
|---|---|
| `VITE_DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `VITE_DEEPSEEK_MODEL` | `deepseek-v4-pro` |
| `VITE_DEEPSEEK_API_KEY` | `""` |
| `VITE_LLM_AGENT_ENABLED` | `false` |

**错误处理策略**：

| 场景 | 处理 |
|---|---|
| `apiKey` 为空 | 抛出 `LLMError("api_key_missing")` |
| `fetch` 抛出 `TypeError` | 抛出 `LLMError("network_error")`（CORS/网络不可达） |
| HTTP 非 200 | 读取错误体，抛出 `LLMError("http_error", message, statusCode)` |
| 响应体 JSON 解析失败 | 抛出 `LLMError("parse_error")` |

**网络适配约束（V3）**：
- V3 使用 `fetch`，不引入 `@tauri-apps/plugin-http`
- V3.1 TODO：若 Tauri WebView 出现 CORS 限制，替换此文件内的 fetch 逻辑，接口层无需改动

---

### 3.3 `src/agent/llm/schemas.ts` — LLM 输出 Schema

**性质**：新增  
**职责**：用 Zod 定义 LLM 必须输出的 JSON 结构，并提供运行时解析工具。

**核心 Schema**（`LLMResponseSchema`）：

```typescript
{
  type: "tool_plan" | "clarification" | "chitchat" | "unsupported"
  intent: IntentType（含 "unknown"）
  toolName: string | null
  params: Record<string, unknown>
  requiresConfirmation: boolean     // 注：代码层会二次覆盖危险操作
  riskLevel: "safe" | "confirm" | "destructive"  // 注：代码层以 CONFIRMATION_POLICY 覆盖
  summary: string
  clarifyingQuestion: string | null
  confidence: number（0-1）
}
```

**工具函数**：

| 函数 | 说明 |
|---|---|
| `extractJSON(raw)` | 从字符串中提取 JSON，自动剥离 ` ```json ``` ` Markdown 代码块 |
| `parseLLMResponse(raw)` | 完整解析 + Zod 校验，返回 `{success, data}` 或 `{success:false, error}` |

---

### 3.4 `src/agent/llm/prompts.ts` — System Prompt

**性质**：新增  
**职责**：定义 LLM 的身份、行为约束、工具列表和输出格式。

**主要导出**：

| 函数 | 说明 |
|---|---|
| `buildSystemPrompt(currentDateTime)` | 生成完整 system prompt，注入当前时间 |
| `formatContextBlock(context)` | 将今日任务/时间块/最近操作 ID 格式化为注入到 user message 前的上下文文本 |

**Prompt 内容结构**：
1. 身份声明（Time Manager 计划管理 Agent）
2. 17 个工具的精简描述表（name | 说明 | 关键参数）
3. JSON 输出格式规范（`type`/`toolName`/`params` 等字段详细说明）
4. 安全规则（不假装完成、危险操作必须确认、参数不足必须追问等）
5. 上下文使用说明（指代消解规则、时间表达式转换要求）

**Token 控制**：Prompt 约 600-800 token，上下文块约 300-500 token，总计控制在 1500 token 以内。

---

### 3.5 `src/agent/llm/contextBuilder.ts` — 上下文构造器

**性质**：新增  
**职责**：为每次 LLM 调用提供轻量结构化上下文，避免"无记忆"问题。

**`ContextBuilder.build()` 输入**：

| 参数 | 说明 |
|---|---|
| `recentMessages` | chatStore 传入的最近消息（最多取后 6 条，每条截断到 300 字符） |
| `lastTaskId` | AgentService 追踪的最近操作任务 ID |
| `lastTimeBlockId` | AgentService 追踪的最近操作时间块 ID |

**自动拉取**：
- 今日未完成任务列表（最多 20 条，仅 id/title/status/priority）
- 今日 TimeBlock 列表（id/title/start_time/end_time/status）

**错误处理**：两个 fetch 均在内部 try/catch，失败时返回空列表，不阻断 LLM 请求。

---

### 3.6 `src/agent/LLMPlanner.ts` — LLM 核心胶水层

**性质**：新增  
**职责**：将用户输入 + LLMContext 转换为 `LLMPlanResult`，不执行工具，不直接依赖 fetch。

**`LLMPlanner.plan()` 处理流程**：

```
1. buildSystemPrompt(当前时间)
2. formatContextBlock(context) 拼入 user message 前
3. 拼接历史消息（最近 N-1 条）+ 当前 user message
4. llmClient.chat(messages)
5. parseLLMResponse(rawContent)  ← Zod 校验
6. 安全校验：
   - toolName 是否在 ToolRouter 注册表
   - 危险 intent 强制 requiresConfirmation=true
   - riskLevel 以 CONFIRMATION_POLICY 为准
7. 返回 LLMPlanResult
```

**`LLMPlanResult` 类型字段**：

| 字段 | 说明 |
|---|---|
| `type` | `tool_plan` \| `clarification` \| `chitchat` \| `unsupported` \| `api_key_missing` \| `network_error` \| `parse_error` \| `fallback` |
| `intent` | 映射后的 `IntentType` |
| `toolName` | 要调用的工具名 |
| `params` | 工具参数 |
| `requiresConfirmation` | 是否需要用户确认（已经过安全覆盖） |
| `riskLevel` | 风险等级（已经过策略覆盖） |
| `summary` | 人类可读摘要 |
| `confidence` | LLM 置信度 |
| `clarifyingQuestion` | 追问内容（type=clarification 时） |
| `replyMessage` | 回复内容（type=chitchat/unsupported 时） |
| `modelName` | 使用的模型名称 |

**异常处理**：`plan()` 不抛出异常，所有错误封装在返回值 `type` 中。

---

### 3.7 `src/agent/AgentService.ts` — 双路径协调器（V3 改造）

**性质**：全量重写（在 V2.5 版本基础上扩展）  
**职责**：协调 LLM 路径与规则路径，统一管理 ActionLog、Confirmation、ToolRouter 执行。

**V3 新增内容**：
- 构造函数中初始化 `DeepSeekClient`、`LLMPlanner`、`ContextBuilder`
- `processInput` 扩展为三阶段：
  1. 检查 LLM 是否启用（`VITE_LLM_AGENT_ENABLED`）
  2. 若启用，调用 `processWithLLM()`；返回 `null` 则 fallback
  3. 调用 `processWithRules()`（原 V2.5 逻辑完整保留）
- 新增 `processWithLLM()` 私有方法：处理 LLM 返回的 8 种 type
- 新增 `executeToolPlan()` 私有方法：LLM 路径和规则路径共用的工具执行逻辑
- `trackLastEntities()` 扩展为同时追踪 `lastOperatedTaskId` 和 `lastOperatedTimeBlockId`

**新签名**：

```typescript
processInput(
  userInput: string,
  context?: ProcessInputContext  // V3 新增，含 recentMessages
): Promise<AgentResponse>
```

**`processWithLLM()` 分支处理**：

| LLMPlanResult.type | 处理 |
|---|---|
| `api_key_missing` | Chat 显示配置提示，写 ActionLog failure |
| `network_error` | Chat 提示"网络失败，已切换规则解析"，fallback |
| `parse_error` / `fallback` | console.warn，返回 null 触发规则 fallback |
| `clarification` | Chat 显示追问，写 ActionLog failure（保存追问记录） |
| `chitchat` | Chat 显示闲聊回复，写 ActionLog failure |
| `unsupported` | Chat 显示不支持提示，写 ActionLog failure |
| `tool_plan` | 调用 `executeToolPlan()`，走完整确认/执行/日志流程 |

---

### 3.8 `src/agent/types.ts` — 类型契约（V3 扩展）

**性质**：局部修改（在 V2.5 基础上扩展 `ChatMessageMetadata`）

**V3 新增字段**：

```typescript
interface ChatMessageMetadata {
  // ... 原有字段保留 ...
  source?: "chat" | "heartbeat" | "system" | "llm";  // 新增 "llm"
  llmModel?: string;         // LLM 模型名称（如 "deepseek-v4-pro"）
  confidence?: number;       // LLM 置信度 0-1
  llmResponseType?: "tool_plan" | "clarification" | "chitchat" | "unsupported";
}
```

---

### 3.9 `src/store/chatStore.ts` — 上下文传递（V3 改造）

**性质**：局部修改  
**修改内容**：`sendMessage` 中在调用 `agentService.processInput` 时，将当前 `messages`
截取最近 6 条作为 `recentMessages` 传入上下文（用于 LLM 指代消解）。

```typescript
const recentMessages = currentMessages
  .slice(-6)
  .map((m) => ({ role: m.role, content: m.content }));

await agentService.processInput(content, { recentMessages });
```

---

### 3.10 `src/components/chat/ChatMessage.tsx` — LLM 样式支持（V3 改造）

**性质**：局部修改  
**新增功能**：

| 场景 | 样式 |
|---|---|
| `metadata.llmResponseType === "clarification"` | 琥珀色气泡（`bg-amber-50 border-amber-200`）+ ❓ 图标 |
| `metadata.llmResponseType === "unsupported"` | 灰色气泡（`bg-gray-50 border-gray-200`）+ 🚫 图标 |
| `metadata.source === "llm"` | 气泡底部显示 `✨ {llmModel}` 小标签 |
| `tool_plan` / 确认按钮 | 与 V2.5 完全相同，无变化 |

---

### 3.11 `src/vite-env.d.ts` — Vite 类型声明（V3 补充）

**性质**：新增（修复 `import.meta.env` 类型错误）  
**内容**：`/// <reference types="vite/client" />`

---

## 四、V3 数据流

### LLM 路径（正常流程）

```
用户输入
  ↓
chatStore.sendMessage(content)
  └─ 取最近 6 条消息 → ProcessInputContext
  ↓
AgentService.processInput(userInput, context)
  ↓（VITE_LLM_AGENT_ENABLED=true 且 API key 已配置）
AgentService.processWithLLM()
  ↓
ContextBuilder.build()                   ← 拉取今日任务/时间块
  ↓
LLMPlanner.plan(userInput, llmContext)
  ↓
DeepSeekClient.chat(messages)            ← fetch → DeepSeek API
  ↓
parseLLMResponse(rawContent)             ← Zod 校验
  ↓（type=tool_plan）
AgentService.executeToolPlan()
  ├─ requiresConfirmation=true → ConfirmationService.create → pending_confirmations
  └─ requiresConfirmation=false → ToolRouter.execute → Tool → Service → SQLite
  ↓
ActionLogService.log(success/failure)    ← agent_action_logs
  ↓
AgentResponse { message, metadata }
  ↓
chatStore → conversationRepo.create(metadata_json)
  ↓
ChatMessage.tsx 渲染（含 LLM 标记）
```

### Fallback 路径

```
DeepSeekClient 抛出 LLMError（任何原因）
  ↓
LLMPlanner 返回 type=network_error / fallback
  ↓
AgentService.processWithLLM 返回 null 或网络错误提示
  ↓
AgentService.processWithRules(userInput)  ← 原 V2.5 完整逻辑
  ↓
IntentParser.parse → AgentCommand → AgentActionPlan → ToolRouter → ActionLog
```

---

## 五、配置说明

### 环境变量（`.env.example`）

```bash
VITE_DEEPSEEK_BASE_URL=https://api.deepseek.com
VITE_DEEPSEEK_MODEL=deepseek-v4-pro
VITE_DEEPSEEK_API_KEY=              # 填入真实 key 后启用 LLM Agent
VITE_LLM_AGENT_ENABLED=true
```

### 启动方式

1. 复制 `.env.example` 为 `.env`
2. 填入 `VITE_DEEPSEEK_API_KEY`
3. `pnpm dev` 或 `pnpm tauri dev`

API key 为空时应用正常启动，Chat 输入任何内容会提示"尚未配置 DeepSeek API Key"并 fallback 到规则解析。

---

## 六、安全边界

| 规则 | 实现位置 |
|---|---|
| LLM 不直接调用 Service/Repository | LLMPlanner 只输出 JSON，不持有任何 Service 引用 |
| LLM 不决定跳过确认 | AgentService 强制以 `CONFIRMATION_POLICY` 覆盖 LLM 的 `requiresConfirmation` |
| LLM 选择的工具必须存在 | LLMPlanner 校验 `router.getTool(toolName)` |
| LLM 输出必须通过 schema 校验 | `parseLLMResponse()` 用 Zod `safeParse` |
| API key 不泄露到 Chat | key 仅在 `DeepSeekClient` 内部读取，不传给 prompt，不出现在消息内容 |
| Tool 参数最终由 Service 层校验 | 各 Tool 内部调用 Service，Service 有 Zod schema 校验 |
