# Time Manager V3 — External Context 插件架构

> 本文描述 V3 预计代码结构、数据流、接口和迁移方案。  
> 目标是把网页读取、微信会话读取和未来其他外部信息源做成相对独立的上下文采集组件，降低对 V0-V2 主流程的侵入。

> 当前项目只作为测试宿主。长期形态应是一个可单独安装、单独运行、通过接口向 Time Manager 提供结构化上下文的 External Context 组件。

---

## 1. 推荐目录结构

建议长期新增目录：

```txt
src/plugins/external-context/
├── index.ts
├── types.ts
├── README.md
├── services/
│   ├── ExternalContextService.ts
│   ├── ExternalContextBuilder.ts
│   ├── WeChatWatchService.ts
│   └── ContextTaskEnhancer.ts
├── providers/
│   ├── ExternalContextProvider.ts
│   ├── OpenCLIWebProvider.ts
│   ├── WxCliProvider.ts
│   └── MockExtractorProvider.ts
├── repositories/
│   ├── IExternalSourceRepository.ts
│   ├── IExternalContextRepository.ts
│   ├── IWeChatWatchRepository.ts
│   ├── SqliteExternalSourceRepository.ts
│   ├── SqliteExternalContextRepository.ts
│   └── SqliteWeChatWatchRepository.ts
├── agent-tools/
│   ├── extractWebContextTool.ts
│   ├── readWeChatContextTool.ts
│   ├── watchWeChatConversationTool.ts
│   └── explainExternalContextTool.ts
├── components/
│   ├── WebContextInput.tsx
│   ├── WeChatSessionPicker.tsx
│   ├── WeChatHistoryPreview.tsx
│   └── ExternalContextStatus.tsx
└── migrations/
    └── v5_external_context.ts
```

### 1.1 为什么用插件目录

当前项目已有清晰分层：

- `src/services`
- `src/repositories`
- `src/agent/tools`
- `src/components`
- `src/store`

如果 V3 直接把所有文件散进这些目录，短期符合旧结构，但后续排查外部上下文读取问题会比较痛苦。`src/plugins/external-context` 可以把该功能的核心资产收在一起，也方便未来整体拆出。

主项目只需要少量接入点：

- `ChatInput.tsx` 提供临时测试入口
- `AgentService.registerTools()` 注册 external-context tools
- `migrations.ts` 调用插件 migration
- 未来通过接口消费 `ExternalContext`，不直接调用 OpenCLI / wx-cli

---

## 2. 核心数据流

### 2.1 手动 TodoForm 路径

```txt
TodoForm
  -> taskStore.addTask()
  -> TaskService.createTask()
  -> LinkContextService.attachUrlToTask(taskId, url)
  -> LinkExtractorProvider.extract(url)
  -> LinkContextBuilder.build(extractedContent)
  -> LinkSourceRepository / LinkSnapshotRepository / TaskLinkRepository
```

> 该路径保留为网页类上下文的长期接入方式，但 V3 当前优先验证独立 External Context 组件，不急于修改 TodoForm。

建议首版采用“先创建任务，再异步处理链接”的策略。

原因：

- 链接读取可能慢。
- OpenCLI 或浏览器桥接可能不可用。
- 用户创建 Todo 的主流程不应被外部网页状态阻塞。

### 2.2 Chat Agent 路径

```txt
ChatInput
  -> chatStore.sendMessage()
  -> AgentService.processInput()
  -> UrlExtractor.extractFromText(userInput)
  -> IntentParser.parse(userInputWithoutUrl?)
  -> ToolRouter.execute("extract_link_context")
  -> ToolRouter.execute("create_task" / "schedule_task")
```

两种实现策略：

1. V3 首版简单策略：在 `AgentService.processInput` 中预处理 URL，并把 `linkContextIds` 放进 intent args。
2. 后续 Agent 化策略：让 Agent 自己按工具链顺序调用 `extract_link_context`、`create_task_from_link`、`schedule_task`。

当前项目的 V1 Agent 是规则化 Agent，不是真 LLM。V3 首版建议采用策略 1，减少复杂度。

### 2.3 微信会话读取路径

```txt
WeChatSessionPicker / Chat test mode
  -> ExternalContextService.previewWeChatHistory()
  -> WxCliProvider.history(chat, range)
  -> WeChatMessageBatch
  -> ExternalContextBuilder.buildFromWeChat()
  -> ExternalContext
```

首版支持两类定向读取：

- 数量回溯：读取 `xx群` 最近 `N` 条。
- 时间回溯：读取 `xx人` 从某天开始到某天结束的消息。对“最近 2 小时”这类相对时间，由组件换算并在内存中过滤。

### 2.4 微信 Heartbeat 监听路径

```txt
Heartbeat tick
  -> WeChatWatchService.pollEnabledTargets()
  -> WxCliProvider.history(chat, since=cursor.lastSeenAt date)
  -> filterAfterCursor()
  -> dedupeByFingerprint()
  -> WeChatMessageBatch
  -> ExternalContextBuilder
  -> Agent Inbox / Scheduler
  -> update cursor
```

不要直接依赖微信客户端“已读”状态。首版维护组件内部的 processed cursor。

cursor 推荐字段：

```ts
export interface WeChatWatchCursor {
  watchId: string;
  chatName: string;
  lastSeenAt?: string;
  lastSeenMessageId?: string;
  lastSeenFingerprint?: string;
  recentFingerprints: string[];
  lastPollAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
}
```

---

## 3. 类型设计

### 3.1 LinkSource

```ts
export interface LinkSource {
  id: string;
  url: string;
  normalized_url: string;
  title?: string;
  source_type: LinkSourceType;
  status: LinkSourceStatus;
  error_message?: string;
  created_at: string;
  updated_at: string;
  last_fetched_at?: string;
  deleted_at?: string;
}
```

```ts
export type LinkSourceType =
  | "candidate_site"
  | "article"
  | "docs"
  | "company_page"
  | "other"
  | "unknown";

export type LinkSourceStatus =
  | "pending"
  | "extracting"
  | "ready"
  | "failed"
  | "archived";
```

### 3.2 LinkSnapshot

```ts
export interface LinkSnapshot {
  id: string;
  source_id: string;
  provider: string;
  raw_text?: string;
  markdown?: string;
  extracted_json?: string;
  summary?: string;
  content_hash?: string;
  captured_at: string;
}
```

### 3.3 LinkContext

`LinkContext` 是给 Agent 和 Todo 构建使用的稳定结构，不一定与数据库表一一对应。

```ts
export interface LinkContext {
  sourceId: string;
  snapshotId: string;
  url: string;
  title?: string;
  pageType: LinkSourceType;
  summary: string;
  keyPoints: string[];
  suggestedTaskTitle?: string;
  suggestedDescription?: string;
  suggestedCategory?: string;
  suggestedDurationMinutes?: number;
  reviewFocus?: string[];
  confidence: number;
}
```

### 3.5 ExternalContext

`ExternalContext` 是网页、微信会话和未来其他来源统一输出给 Agent 的结构。

```ts
export interface ExternalContext {
  id: string;
  sourceType: "webpage" | "wechat_conversation";
  sourceId: string;
  title: string;
  summary: string;
  keyPoints: string[];
  content?: ExternalContentItem[];
  attachments?: ExternalAttachmentRef[];
  actionItems?: string[];
  risks?: string[];
  rawExcerpt?: string;
  sourceRefs: ExternalSourceRef[];
  createdAt: string;
  confidence: number;
}

export interface ExternalSourceRef {
  type: "url" | "wechat_message";
  label: string;
  locator: string;
  sentAt?: string;
  sender?: string;
}

export interface ExternalContentItem {
  type: "text" | "image" | "voice" | "video" | "file" | "link" | "system" | "unknown";
  text?: string;
  sender?: string;
  sentAt?: string;
  sourceRefLocator?: string;
  attachmentIds?: string[];
}

export interface ExternalAttachmentRef {
  id: string;
  kind: "image" | "voice" | "video" | "file";
  status: "metadata_only" | "available" | "exported" | "missing";
  sourceRefLocator: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  localPath?: string;
  thumbnailPath?: string;
  note?: string;
}
```

### 3.6 WeChatMessageBatch

```ts
export interface WeChatMessageBatch {
  id: string;
  watchId?: string;
  chatName: string;
  range: {
    mode: "latest" | "date_range" | "relative" | "incremental";
    limit?: number;
    since?: string;
    until?: string;
  };
  messages: WeChatMessage[];
  createdAt: string;
}

export interface WeChatMessage {
  id?: string;
  chatName: string;
  sender?: string;
  type: "text" | "image" | "voice" | "video" | "sticker" | "location" | "link" | "file" | "call" | "system";
  content: string;
  sentAt: string;
  fingerprint: string;
  attachmentIds?: string[];
}
```

微信图片设计原则：

- 图片消息进入 `content`，类型为 `image`，不丢弃。
- 图片本体不直接塞进 JSON；JSON 只保存 `ExternalAttachmentRef`，包含 `attachment_id`、来源消息、可用状态和可选本地路径。
- 下游 Agent 可以先基于文本消息工作；需要理解图片时，再按 `attachmentIds` 显式请求图片导出、OCR 或视觉模型处理。
- 默认不批量导出图片，不把图片路径暴露给无关模块。

### 3.4 ExtractedLinkContent

Provider 输出的原始提取结果。

```ts
export interface ExtractedLinkContent {
  url: string;
  finalUrl?: string;
  title?: string;
  text: string;
  markdown?: string;
  links?: Array<{ text: string; href: string }>;
  metadata?: Record<string, unknown>;
}
```

---

## 4. Service 设计

### 4.1 LinkContextService

插件主入口，供 TodoForm、Agent Tools、未来排期服务调用。

```ts
export class LinkContextService {
  attachUrlToTask(input: AttachUrlToTaskInput): Promise<LinkContextJobResult>;
  extractUrl(input: ExtractUrlInput): Promise<LinkContext>;
  getContextsForTask(taskId: string): Promise<LinkContext[]>;
  refreshSource(sourceId: string): Promise<LinkContext>;
}
```

职责：

- 标准化 URL。
- 创建或复用 `LinkSource`。
- 调用 Provider 提取网页内容。
- 调用 Builder 生成 `LinkContext`。
- 保存 Snapshot。
- 建立 Task 与 LinkSource 的绑定关系。

### 4.2 LinkContextBuilder

把网页提取结果整理成稳定结构。

首版可以规则化，不必依赖 LLM：

- 标题来自页面 title 或 h1。
- 摘要取正文前若干段并做清洗。
- 关键词从常见招聘/文档/文章特征中提取。
- 时长根据文本长度、链接数量、页面类型估算。

未来可替换为 `WebsiteDigestAgent`。

### 4.4 ExternalContextBuilder

V3 当前优先使用规则版 Builder，不强制接入 Agent。

原因：

- OpenCLI 的网页输出已经是 Markdown，标题、章节、链接和正文段落相对规整。
- wx-cli 的会话输出已经是 JSON，发送者、时间、消息类型和正文都有明确字段。
- 首版目标是把外部信息整理成稳定中间层，供后续 Agent 消费，而不是直接让 Agent 读原始网页/聊天记录。
- 输出不是面向用户阅读的漂亮摘要卡，而是面向 Agent 的干净 payload：删除导航、按钮、图片 CDN、页面框架文本，保留标题、短摘要、关键点、清洗后的正文片段、相关正文链接和来源引用。
- 置信度只作为内部诊断指标，不作为下游 Agent 判断内容价值的核心字段。下游 Agent 应主要消费 `summary`、`keyPoints`、`content` 和 `sourceRefs`。

规则版能力：

```txt
web markdown
  -> title
  -> summary
  -> headings / key points
  -> links
  -> ExternalContext

wechat history json
  -> participant stats
  -> time range
  -> message type stats
  -> key utterances
  -> attachment refs
  -> action item candidates
  -> ExternalContext
```

Agent 后续只消费 `ExternalContext`：

```txt
ExternalContext -> TodoBuilderAgent / SchedulerAgent / BriefingAgent
```

这样即使没有 LLM，也能完成从“页面/会话原文”到“可供 Agent 使用的上下文摘要”的基础闭环。

### 4.3 LinkTaskEnhancer

把 `LinkContext` 转成 Todo 创建建议。

```ts
export interface TaskDraftFromLink {
  title?: string;
  description?: string;
  category?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  estimated_duration_minutes?: number;
}
```

规则示例：

- `candidate_site`：标题建议“审阅候选人个人网站”。
- `docs`：标题建议“阅读文档：{title}”。
- `article`：标题建议“阅读文章：{title}”。
- 文本量较大或外链较多时，估时提升。

---

## 5. Provider 设计

### 5.1 LinkExtractorProvider

```ts
export interface LinkExtractorProvider {
  name: string;
  doctor(): Promise<LinkExtractorHealth>;
  extract(input: ExtractLinkInput): Promise<ExtractedLinkContent>;
}
```

### 5.2 OpenCLIExtractorProvider

首选实现。该类只负责封装 OpenCLI 调用，不参与 Todo 或 Agent 业务判断。

注意事项：

- 必须设置命令白名单。
- 必须有超时。
- 必须限制输出大小。
- 必须处理 OpenCLI 未安装、Browser Bridge 不可用、页面加载失败等情况。
- 不保存 cookie、token、截图等敏感数据。

### 5.3 MockExtractorProvider

用于开发和测试。

在 OpenCLI 未接入或 CI 环境不可用时，Mock Provider 可以返回固定内容，保证 Todo 和 Agent 数据流可测试。

### 5.4 WxCliProvider

用于读取本机微信数据，封装 wx-cli 命令。

必须遵守：

- 只允许白名单命令：`sessions`、`history`、`search`、`unread`、`new-messages`、`stats`。
- 默认要求用户选择会话和范围，不做全量扫描。
- 默认只读取文本和链接类型，附件需要单独确认。
- 首版不修改微信客户端已读状态。
- 输出进入 `WeChatMessageBatch`，再由 Builder 生成 `ExternalContext`。

典型命令映射：

```txt
listSessions(limit) -> wx.cmd sessions --json -n <limit>
history(chat, limit, since, until, type) -> wx.cmd history <chat> --json -n <limit> ...
search(keyword, chat, limit, since, until) -> wx.cmd search <keyword> --json --in <chat> ...
newMessages(limit) -> wx.cmd new-messages --json -n <limit>
imageAttachments(chat, range) -> wx.cmd attachments <chat> --kind image --json ...
extractAttachment(id, output) -> wx.cmd extract <attachment_id> --output <path> --json
```

附件边界：

- 当前 wx-cli `attachments` 只支持图片。
- PDF、MOV、MP4 只能先通过 `history --type file/video` 查看消息元数据，暂不做文件本体导出。
- 图片导出必须由用户显式选择 `attachment_id`，不默认批量导出。
- Agent 默认只消费图片元数据和来源引用；只有当任务明确需要识图、OCR 或附件归档时，才调用导出/视觉处理链路。

---

## 6. Agent Tools 设计

### 6.1 extract_link_context

读取链接并生成 LinkContext。

输入：

```ts
{
  url: string;
  sourceType?: LinkSourceType;
}
```

输出：

```ts
{
  context: LinkContext;
}
```

### 6.2 attach_link_to_task

把链接绑定到已有 Task。

输入：

```ts
{
  taskId: string;
  url: string;
}
```

输出：

```ts
{
  taskId: string;
  context: LinkContext;
}
```

### 6.3 create_task_from_link

基于用户原始意图和 LinkContext 创建 Task。

输入：

```ts
{
  userInput: string;
  url: string;
  contextId?: string;
}
```

输出：

```ts
{
  task: Task;
  context: LinkContext;
}
```

### 6.4 explain_task_link_context

回答某个 Task 绑定链接的主要内容。

输入：

```ts
{
  taskId?: string;
  titleKeyword?: string;
}
```

输出：

```ts
{
  summary: string;
  keyPoints: string[];
  reviewFocus?: string[];
}
```

---

## 7. 数据库迁移建议

建议新增 migration v5。

```sql
CREATE TABLE link_sources (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  title TEXT,
  source_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK(source_type IN ('candidate_site','article','docs','company_page','other','unknown')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','extracting','ready','failed','archived')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_fetched_at TEXT,
  deleted_at TEXT
);
```

```sql
CREATE TABLE link_snapshots (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES link_sources(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  raw_text TEXT,
  markdown TEXT,
  extracted_json TEXT,
  summary TEXT,
  content_hash TEXT,
  captured_at TEXT NOT NULL
);
```

```sql
CREATE TABLE task_link_sources (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES link_sources(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'reference'
    CHECK(role IN ('reference','candidate_site','doc','other')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, source_id)
);
```

建议索引：

```sql
CREATE UNIQUE INDEX idx_link_sources_normalized_url
  ON link_sources(normalized_url)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_link_snapshots_source_id
  ON link_snapshots(source_id);

CREATE INDEX idx_task_link_sources_task_id
  ON task_link_sources(task_id);
```

---

## 8. 与现有系统的接入点

### 8.1 TodoForm

新增可选字段：

```txt
相关链接（可选）
```

提交时：

1. 先创建 Task。
2. 如果有链接，调用 `LinkContextService.attachUrlToTask`。
3. UI 显示链接处理状态。

### 8.2 Task 类型

不建议直接在 `tasks` 表加 `url` 字段。任务与链接是多对多关系，应通过 `task_link_sources` 关联。

### 8.3 Chat Agent

`AgentService` 增加 URL 预处理：

- 从用户输入中提取 URL。
- 保留原始输入。
- 将 URL 放入 `intent.args.urls`。
- 对创建任务、安排任务、解释链接内容等意图使用 link-context tools。

### 8.4 ScheduleService

首版不强依赖 LinkContext。

但当 Task 没有 `estimated_duration_minutes` 时，可以用 LinkContext 的 `suggestedDurationMinutes` 作为默认估时。

---

## 9. 错误处理

### 9.1 OpenCLI 不可用

行为：

- Task 创建成功。
- LinkSource 状态为 `failed`。
- `error_message` 保存错误摘要。
- UI 提示“任务已创建，链接内容暂时无法读取”。

### 9.2 链接无法访问

行为：

- 保存 LinkSource。
- 标记 `failed`。
- 不阻塞 Todo。

### 9.3 内容过大

行为：

- Provider 层裁剪 raw text。
- Snapshot 记录 `metadata.truncated = true`。
- Builder 基于裁剪内容生成摘要。

### 9.4 重复链接

行为：

- 通过 `normalized_url` 复用 `link_sources`。
- 如果已有可用 snapshot，可以先复用。
- 用户可手动刷新。

---

## 10. 安全与隐私

- 默认不保存截图。
- 默认不保存 cookie、token、请求头。
- 默认只保存网页正文、摘要和结构化信息。
- 对需要登录的网站，UI 应明确提示用户当前会读取已登录浏览器可见内容。
- 对敏感链接允许用户删除 LinkSource 和相关 Snapshot。
- Agent 默认只能读取已保存的 LinkContext，不应无限制驱动浏览器。
