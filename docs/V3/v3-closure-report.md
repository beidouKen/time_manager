# Time Manager V3 — 封板预报告

> 文档版本：1.0（预报告）  
> 生成日期：2026-05-19  
> 项目版本：V3（DeepSeek LLM Agent 接入版）  
> 报告性质：**预报告**——代码实现和编译验证已完成，手工验收场景待用户填写 API key 后确认

---

## 1. V3 目标回顾

V3 在 V2.5 Agent Tool Contract 基础上，接入 DeepSeek LLM，让 Chat Agent 能够：

1. 自然语言理解（不再依赖有限的正则规则）
2. 结构化意图解析
3. 工具选择与参数抽取
4. 缺参追问（clarification）
5. 多候选歧义澄清
6. 普通闲聊响应（chitchat）
7. 超能力边界提示（unsupported）
8. 严格遵守 V2.5 的安全约束：Agent 不直接改数据库、危险操作必须确认、所有操作记 ActionLog

---

## 2. 已完成内容

### V3.1 — 环境配置

**文件**：`.env.example`（新增）、`src/vite-env.d.ts`（新增）

- 新建 `.env.example`，含四个环境变量：
  `VITE_DEEPSEEK_BASE_URL` / `VITE_DEEPSEEK_MODEL` / `VITE_DEEPSEEK_API_KEY` / `VITE_LLM_AGENT_ENABLED`
- 补充缺失的 `src/vite-env.d.ts`（`/// <reference types="vite/client" />`），
  修复 `import.meta.env` 在严格 TypeScript 下的类型错误

---

### V3.2 — LLM Adapter 层

**目录**：`src/agent/llm/`（全部新增）

#### `LLMClient.ts` — 统一接口

定义 `LLMClient` 接口（`chat` / `isAvailable` / `getModelName`）和 `LLMError` 错误类
（携带 `kind`: `api_key_missing` | `network_error` | `http_error` | `parse_error` | `unknown`）。

**设计要点**：`AgentService` 和 `LLMPlanner` 只依赖此接口，不直接依赖 `fetch`。
V3.1 切换为 `@tauri-apps/plugin-http` 时，上层代码零改动。

#### `DeepSeekClient.ts` — DeepSeek 实现

- 实现 `LLMClient` 接口
- 使用浏览器原生 `fetch`（OpenAI-compatible Chat Completions 风格）
- 每次调用重新读取 `import.meta.env` 配置（支持运行时热更新）
- API key 缺失 → `LLMError("api_key_missing")`
- `fetch` 抛 TypeError（CORS/网络不可达）→ `LLMError("network_error")`
- HTTP 非 200 → `LLMError("http_error", message, statusCode)`
- 响应 JSON 解析失败 → `LLMError("parse_error")`

#### `schemas.ts` — Zod Schema

- `LLMResponseSchema`：定义 LLM 必须输出的 JSON 结构（type / intent / toolName / params /
  requiresConfirmation / riskLevel / summary / clarifyingQuestion / confidence）
- `extractJSON(raw)`：自动剥离 ` ```json ``` ` Markdown 代码块
- `parseLLMResponse(raw)`：完整解析 + Zod safeParse，返回 `{success, data}` 或 `{success:false, error}`

#### `prompts.ts` — System Prompt

- `buildSystemPrompt(currentDateTime)`：生成完整 system prompt
  - 明确身份、禁止事项、输出格式要求
  - 17 个工具的精简描述表（name | 说明 | 关键参数）
  - 安全规则（危险操作确认、参数不足追问、不假装完成等）
  - 时间表达式转换要求（ISO 8601）
- `formatContextBlock(context)`：将今日任务/时间块/最近操作 ID 格式化为上下文文本块

#### `contextBuilder.ts` — 上下文构造器

- `ContextBuilder.build(recentMessages, lastTaskId, lastTimeBlockId)`
- 并行拉取今日未完成任务（最多 20 条）和今日 TimeBlock
- 截取最近 6 条消息，每条限 300 字符
- 任何 fetch 失败均静默降级（返回空列表），不阻断 LLM 请求

---

### V3.3 — LLMPlanner（核心胶水层）

**文件**：`src/agent/LLMPlanner.ts`（新增）

`LLMPlanner.plan(userInput, llmContext)` 完整流程：

1. 组装 messages（system prompt + 历史消息 + 带上下文块的 user message）
2. `llmClient.chat(messages)`
3. `parseLLMResponse(rawContent)` Zod 校验
4. 安全校验：
   - `toolName` 必须在 ToolRouter 注册表（`router.getTool(name)`）
   - `delete_task` / `delete_time_block` / `reschedule_day` 强制 `requiresConfirmation=true`
   - `riskLevel` 以 `CONFIRMATION_POLICY` 覆盖 LLM 返回值
5. 返回 `LLMPlanResult`（绝不抛异常，所有错误封装在 `type` 字段）

---

### V3.4 — AgentService 改造

**文件**：`src/agent/AgentService.ts`（全量重写，在 V2.5 基础上扩展）

新增逻辑：

- 构造函数初始化 `DeepSeekClient`、`LLMPlanner`、`ContextBuilder`
- `processInput(userInput, context?)` 三阶段：
  1. 检查 `VITE_LLM_AGENT_ENABLED`
  2. `processWithLLM()` → 处理 8 种 `LLMPlanResult.type`
  3. `processWithRules()` ← V2.5 原逻辑完整保留，用于 fallback 或 LLM 未启用
- `executeToolPlan()` 提取为私有方法，LLM 路径和规则路径共用（避免重复代码）
- `trackLastEntities()` 同时追踪 `lastOperatedTaskId` 和 `lastOperatedTimeBlockId`

**各 LLM 响应类型处理**：

| LLM type | AgentService 行为 |
|---|---|
| `api_key_missing` | 写 ActionLog failure，返回配置提示消息 |
| `network_error` | 写警告日志，在提示前追加"网络失败"前缀，继续规则 fallback |
| `parse_error` / `fallback` | 写警告日志，返回 null 触发规则 fallback |
| `clarification` | 写 ActionLog failure，返回 LLM 的追问消息 |
| `chitchat` | 写 ActionLog failure，返回闲聊回复 |
| `unsupported` | 写 ActionLog failure，返回不支持提示 |
| `tool_plan` | `executeToolPlan()` → 确认/执行/ActionLog 完整链路 |

**V2.5 行为完全向后兼容**：
- `confirmAction` / `rejectAction` 未改动
- `resolveArgs` / `buildConfirmDescription` / `resolveScheduleTime` 未改动
- 17 个 Tool 注册逻辑未改动

---

### V3.5 — 类型扩展

**文件**：`src/agent/types.ts`（局部修改）

`ChatMessageMetadata` 新增：

```typescript
source?: "chat" | "heartbeat" | "system" | "llm";  // 新增 "llm"
llmModel?: string;           // LLM 模型名称
confidence?: number;         // 置信度 0-1
llmResponseType?: "tool_plan" | "clarification" | "chitchat" | "unsupported";
```

---

### V3.6 — chatStore 改造

**文件**：`src/store/chatStore.ts`（局部修改）

`sendMessage` 在调用 `agentService.processInput` 时，额外传入最近 6 条消息作为上下文：

```typescript
const recentMessages = currentMessages.slice(-6).map(m => ({ role: m.role, content: m.content }));
await agentService.processInput(content, { recentMessages });
```

---

### V3.7 — ChatMessage UI

**文件**：`src/components/chat/ChatMessage.tsx`（局部修改）

| 条件 | 样式变化 |
|---|---|
| `llmResponseType === "clarification"` | 琥珀色气泡 + ❓ 图标 |
| `llmResponseType === "unsupported"` | 灰色气泡 + 🚫 图标 |
| `source === "llm"` | 气泡底部显示 `✨ {llmModel}` 小标签 |
| 确认/取消按钮 | 与 V2.5 完全相同，无变化 |

---

## 3. 技术设计决策说明

| 决策 | 理由 |
|---|---|
| LLMClient 接口隔离 | AgentService/LLMPlanner 不直接依赖 fetch；V3.1 切换实现时上层零改动 |
| V3 使用浏览器 fetch，不引入 @tauri-apps/plugin-http | 减少依赖，降低引入风险；若真机出现 CORS 问题才在 V3.1 切换 |
| 双路径设计（LLM 路径 + 规则 fallback） | LLM 不可用、网络错误、解析失败时应用仍可工作 |
| API key 缺失时不崩溃，提示后 fallback | 开发者拉取代码后无需配置 key 即可运行 |
| CONFIRMATION_POLICY 在代码层强制覆盖 LLM 的 riskLevel | 不信任 LLM 的安全判断；危险操作确认由代码决定，LLM 无法绕过 |
| extractJSON 自动剥离 Markdown 代码块 | LLM 偶尔输出 \```json...\``` 包裹，此处做防御性清洗 |
| executeToolPlan 提取为共用方法 | LLM 路径和规则路径的确认/执行/日志逻辑完全一致，避免重复维护 |
| contextBuilder 错误静默降级 | 今日任务/时间块获取失败不应阻断 LLM 请求 |
| 不改动 17 个 Tool、Service、Repository、DB migration | V3 是在 Agent 层新增能力，不涉及数据模型变更 |

---

## 4. 修改文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `.env.example` | 新增 | 环境变量模板 |
| `src/vite-env.d.ts` | 新增 | 修复 import.meta.env 类型错误 |
| `src/agent/llm/LLMClient.ts` | 新增 | 统一 LLM 接口 + LLMError |
| `src/agent/llm/DeepSeekClient.ts` | 新增 | DeepSeek fetch 实现 |
| `src/agent/llm/schemas.ts` | 新增 | Zod schema + JSON 解析工具 |
| `src/agent/llm/prompts.ts` | 新增 | System prompt + 上下文格式化 |
| `src/agent/llm/contextBuilder.ts` | 新增 | 今日任务/时间块/消息上下文构造 |
| `src/agent/LLMPlanner.ts` | 新增 | LLM 解析核心胶水层 |
| `src/agent/types.ts` | 局部修改 | ChatMessageMetadata 增加 LLM 字段 |
| `src/agent/AgentService.ts` | 全量重写 | 双路径协调（LLM + 规则 fallback） |
| `src/store/chatStore.ts` | 局部修改 | sendMessage 传递上下文 |
| `src/components/chat/ChatMessage.tsx` | 局部修改 | LLM 标记和响应类型样式 |

**未修改文件**：17 个 Tool 文件、IntentParser.ts、ToolRouter.ts（结构不变）、
HeartbeatService.ts、所有 Repository 文件、所有 Service 文件、
db/migrations.ts、TodayPage/SettingsPage/AppLayout 等 UI 组件

---

## 5. 编译验证结果

```
$ npx tsc --noEmit
npm warn Unknown project config "approve-builds".
（无错误，exit code 0）

$ pnpm build
vite v6.4.2 building for production...
✓ 2569 modules transformed.
dist/assets/index-DJqIQPGF.js   563.19 kB │ gzip: 164.83 kB
✓ built in 3.21s
（exit code 0）
```

chunk 大小警告（>500KB）为 V2 已有问题，非 V3 引入，不影响功能。

---

## 6. 手工验收清单

> 以下场景需要在填写真实 VITE_DEEPSEEK_API_KEY 后手工验证。

### V0/V1/V2/V2.5 回归

- [ ] 应用正常启动，SQLite migration 执行正常
- [ ] Todo CRUD 正常
- [ ] TimeBlock CRUD 正常
- [ ] Task 排期正常
- [ ] 时间冲突检测正常
- [ ] 删除 Task 联动 TimeBlock 软删除正常
- [ ] Chat 页面正常加载，历史消息正常显示
- [ ] Heartbeat 开启/关闭正常
- [ ] Heartbeat FeedbackDialog Done/Skip/Delay 行为不变
- [ ] TimeBlockCard 菜单 Done/Skip/Delay 联动正常
- [ ] 旧 Chat 消息（metadata_json 只含 confirmationId）确认按钮仍可用

### V3 新增验收场景

**场景 1：API key 未配置**
- [ ] 启动应用，不填 VITE_DEEPSEEK_API_KEY
- [ ] Chat 输入任意内容
- [ ] 期望：不崩溃；显示"尚未配置 DeepSeek API Key"提示；fallback 到规则解析正常响应

**场景 2：创建任务**
- [ ] 配置 API key
- [ ] Chat 输入："帮我创建一个任务：写数据挖掘报告，明天截止，预计两个小时"
- [ ] 期望：LLM 解析为 create_task；Task 创建；ActionLog success；Chat 回复成功；消息底部有 `✨ deepseek-v4-pro` 标记

**场景 3：安排任务**
- [ ] Chat 输入："明天下午帮我安排两个小时写数据挖掘报告"
- [ ] 期望：LLM 解析为 schedule_task；如时间块创建成功则 Chat 回复；不假装完成未执行的动作

**场景 4：查询今日计划**
- [ ] Chat 输入："我今天还有什么？"
- [ ] 期望：LLM 解析为 get_today_plan；返回今日 TimeBlock 列表

**场景 5：标记完成（可唯一定位）**
- [ ] 已有任务"写数据挖掘报告"
- [ ] Chat 输入："把写数据挖掘报告标记为完成"
- [ ] 期望：mark_task_completed 执行成功；Task 状态更新；ActionLog success

**场景 6：标记完成（无法唯一定位）**
- [ ] Chat 输入："把它标记为完成"（无上下文）
- [ ] 期望：LLM 返回 clarification；Chat 显示琥珀色追问气泡（❓ 图标）

**场景 7：删除任务（等待确认）**
- [ ] Chat 输入："删除写数据挖掘报告这个任务"
- [ ] 期望：LLM 生成 delete_task；requiresConfirmation=true；Chat 出现确认/取消按钮；未确认前不删除

**场景 8：拒绝删除**
- [ ] 在场景 7 基础上点击"取消"
- [ ] 期望：Task 不删除；pending_confirmations 变 rejected；ActionLog 记录 cancelled

**场景 9：确认删除**
- [ ] 重新触发删除并点击"确认执行"
- [ ] 期望：Task 软删除；关联 TimeBlock 联动软删除；ActionLog success

**场景 10：越界能力**
- [ ] Chat 输入："帮我打开这个项目文件夹并运行测试"
- [ ] 期望：LLM 返回 unsupported；Chat 显示灰色气泡（🚫 图标）；不执行任何系统命令

**场景 11：网络错误 fallback**
- [ ] 在 .env 中填写错误的 API key 或修改 BASE_URL 为不可达地址
- [ ] Chat 输入任意内容
- [ ] 期望：Chat 提示"网络请求失败，已切换为规则解析"；fallback 结果正常返回；不崩溃

---

## 7. 已知限制（继承 + V3 新增）

| 编号 | 限制 | 来源 |
|---|---|---|
| L1 | 更改 Heartbeat 检查间隔需重开 | 继承自 V2 |
| L2 | 无桌面通知 | 继承自 V2 |
| L3 | 多日 TimeBlock 不处理 | 继承自 V2 |
| L4 | Delay 不自动重排 | 继承自 V2.5 |
| L5 | IntentParser 规则对 5 个新 intent 覆盖不完整 | 继承自 V2.5（V3 LLM 路径已覆盖） |
| L6 | LLM 响应不流式输出（无打字机效果） | V3 首版，延迟约 2-5s |
| L7 | Tauri 真机可能出现 CORS 限制（fetch） | V3 已知风险，V3.1 切换为 @tauri-apps/plugin-http |
| L8 | 不支持多工具顺序执行（如创建任务后立即安排） | V3 首版设计范围，V4 可考虑 |
| L9 | SettingsPage 无 LLM 配置 UI，只能通过 .env | V3 首版，V3.1 可选补充 |
| L10 | LLM 上下文仅最近 6 条消息，长对话可能丢失指代 | V3 首版，未来可扩展 |

---

## 8. 遗留 TODO（V3.1 / V4 接收）

| 编号 | 内容 | 优先级 |
|---|---|---|
| T1 | 若 Tauri 真机 CORS 确认，切换 DeepSeekClient 为 @tauri-apps/plugin-http 实现 | P0（视真机测试结果） |
| T2 | SettingsPage 增加 LLM 配置区（Base URL / Model / API Key 输入框） | P1 |
| T3 | LLM 响应流式输出（打字机效果） | P1 |
| T4 | 多工具顺序执行计划（如 create_task → schedule_task 链式） | P1 |
| T5 | Delay 后 LLM 生成智能重排建议 | P1（继承自 V2.5） |
| T6 | 桌面通知（Tauri notification 插件） | P1（继承自 V2） |
| T7 | 执行分析面板（完成率、延迟率、Agent 操作统计） | P2 |
| T8 | 多日 TimeBlock 与跨日 Heartbeat 场景处理 | P2 |
| T9 | 上下文窗口扩展（超过 6 条历史消息的摘要压缩） | P2 |

---

## 9. 版本命名说明

本版本命名为 **V3 — DeepSeek LLM Agent 接入版**。

V3.1 预留给：真机 CORS 修复 + SettingsPage LLM 配置 UI + 流式输出。  
V4 预留给：多工具链式执行、智能重排、桌面通知等增强功能。
