# Time Manager V3 — External Context 工作流规划

> 文档版本：0.2  
> 目标版本：V3  
> 当前状态：设计 + 当前项目内测试宿主  
> 核心目标：把网页内容、微信会话等外部信息源转化为可被上层 Agent 使用的结构化上下文。

> 方向修正：V3 不再只围绕 `LinkContext`，而是升级为 `ExternalContext`。网页链接是第一类 Provider，微信本地会话是第二类 Provider。当前项目仅作为测试宿主，长期目标是把该能力拆成独立、即装即用的组件，再通过接口接回 Time Manager。

---

## 1. 版本定位

V3 不把 OpenCLI 或 wx-cli 做成 Time Manager 内部的深耦合功能，也不以“网站转代码”为主目标。

本版本更准确的定位是：

> 在 Time Manager 外围验证一套“外部上下文采集工作流”：可定向读取网页和微信会话，生成结构化上下文，并最终供 Todo / Chat Agent / 未来排期 Agent 消费。

首批输入源：

1. 网页链接：通过 OpenCLI `web read` 提取页面 Markdown。
2. 微信会话：通过 wx-cli 定向读取指定联系人/群聊的历史消息、新消息和搜索结果。

系统读取外部内容后，不直接替代用户意图，而是生成一份结构化的 `ExternalContext`。这份上下文可以用于：

- 辅助创建更完整的 Todo 标题、描述、分类、预计时长。
- 让 Chat Agent 后续能回答“这个网页/这段会话里大概是什么内容”。
- 从被选中的微信会话中提取行动项、会议结论、待跟进事项和风险信号。
- 配合 Heartbeat 对特定会话做周期性增量读取。
- 给未来真正的 AI 排期 Agent 提供更快、更稳定的外部资料输入。
- 避免每次排期或解释时重复打开网页或反复扫描微信本地数据。

---

## 2. 设计原则

### 2.1 插件式组织

V3 功能应尽量以一个独立模块组织，避免散落在 `services/`、`agent/tools/`、`repositories/` 中难以追踪。

建议长期新增独立组件目录或独立包：

```txt
src/plugins/external-context/
```

该目录内部自带类型、服务、Provider、Repository、Agent Tools、UI 小组件和迁移说明。当前项目只作为测试宿主，后续可整体拆出为独立组件。

### 2.2 不阻塞原有 Todo 创建

外部上下文是可选增强。

- 不启用外部上下文：现有 Todo / Chat / Heartbeat 流程完全不变。
- 网页或微信读取失败：只记录 source 状态为 `failed`，不影响原有任务系统。
- 提取较慢：先生成读取任务或 watch target，再异步完成上下文生成。

### 2.3 两段式处理

V3 不建议把网页原文或微信原始聊天记录直接丢给 Todo 构建逻辑。

推荐数据流：

```txt
URL
  -> OpenCLI / Website Extractor
  -> ExternalContextBuilder
  -> 结构化 ExternalContext
  -> TodoBuilder / Agent / ScheduleService
```

```txt
WeChat chat selection
  -> wx-cli history/search/new-messages
  -> WeChatMessageBatch
  -> ExternalContextBuilder
  -> 结构化 ExternalContext
  -> Agent Inbox / TodoBuilder / ScheduleService
```

第一段只负责网页读取和整理。  
第二段才负责把整理结果用于 Todo 构建、估时和排期。

### 2.4 Provider 可替换

OpenCLI 只是当前推荐的网页读取 Provider；wx-cli 是当前推荐的微信本地数据 Provider。插件上层不应直接依赖具体命令细节。

统一抽象：

```ts
interface ExternalContextProvider {
  name: string;
  doctor(): Promise<ProviderHealth>;
}
```

网页 Provider 暴露 `extractUrl`；微信 Provider 暴露 `listSessions`、`readHistory`、`searchMessages`、`readNewMessages` 和 watch cursor 能力。

未来可以替换为：

- OpenCLI
- wx-cli
- Playwright
- Tauri 内置 browser/webview 能力
- MCP 网页读取服务
- 真实 LLM browsing tool

---

## 3. 用户故事

### 3.1 手动 Todo 创建

HR 在 Todo 表单里输入：

- 标题：审阅候选人个人网站
- 相关链接：https://candidate.example.com
- 预计时长：不填

系统流程：

1. 创建 Task。
2. 保存链接来源。
3. 异步读取网站内容。
4. 生成 LinkContext。
5. 如果用户未填写预计时长，可根据 LinkContext 给出建议值。
6. 后续 Chat 可以查询该任务的链接摘要。

### 3.2 Chat 创建任务

用户输入：

```txt
帮我创建一个任务，看看这个候选人的个人网站 https://candidate.example.com
```

系统流程：

1. Chat Agent 从消息中提取 URL。
2. IntentParser 识别为创建任务或安排任务。
3. `extract_link_context` 工具读取并整理链接内容。
4. `create_task` 使用用户意图 + LinkContext 构建任务。
5. 如果用户要求安排时间，再进入现有 `schedule_task` 流程。

### 3.3 后续查询

用户输入：

```txt
这个任务绑定的网站里主要有什么？
```

系统流程：

1. Agent 根据最近操作任务或标题关键词定位 Task。
2. 查询 Task 绑定的 LinkContext。
3. 返回摘要、关键点、建议关注事项。

### 3.4 微信会话定向读取

用户选择：

- 会话：某个联系人或群聊
- 回溯方式：最近 N 条，或某个日期/时间范围
- 消息类型：默认文本和链接

系统流程：

1. 调用 wx-cli `history` 读取指定范围。
2. 组件生成 `WeChatMessageBatch`。
3. Builder 生成 `ExternalContext`，包含摘要、关键点、待办、风险和来源引用。
4. 用户确认后，上层 Agent 可以据此创建任务或排期。

### 3.5 微信会话 Heartbeat 监听

用户把某些会话加入 watch target：

1. 组件保存会话名称、轮询频率、回溯窗口、消息上限。
2. Heartbeat 周期执行增量读取。
3. 组件用 cursor 记录每个会话上次处理到的时间、消息 id 或 fingerprint。
4. 新消息合批生成上下文，交给上层 Agent 进行任务提取和计划更新。

---

## 4. 成功标准

V3 首版完成后，应满足：

- 当前项目有隔离的 External Context 测试入口。
- 网页 URL 可以通过 OpenCLI 提取 Markdown。
- 微信会话可以通过 wx-cli 定向读取最近 N 条或指定日期范围。
- 每个微信 watch target 能记录 cursor，支持后续增量读取。
- ExternalContext 能被后续 Agent 查询或消费。
- OpenCLI / wx-cli 调用被封装在 Provider 层，业务代码不直接拼命令。
- 新增数据表或本地状态可独立迁移，可整体拆出当前项目。

---

## 5. 非目标

V3 首版不做：

- 不做完整“网站转代码”。
- 不做自动生成 OpenCLI adapter。
- 不把微信全量聊天数据库导入 Time Manager。
- 不默认保存完整聊天原文，只保存摘要、结构化结果和必要来源引用。
- 不主动修改微信客户端已读状态；首版只维护组件内部的 processed cursor。
- 不强制引入真实 LLM。
- 不做复杂网页截图存储。
- 不做跨账号云同步。
- 不让 Agent 无限制控制浏览器点击敏感页面。
