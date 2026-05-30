# Time Manager V3 — External Context 实施计划

> 本文列出 V3 的预计修改步骤。当前项目作为测试宿主，长期目标是把 External Context 能力拆成独立组件后再通过接口接回 Time Manager。

---

## 1. 阶段拆分

### V3.0 — 当前项目内验证层

目标：先验证 OpenCLI 和 wx-cli 的本地读取能力，并保持代码隔离，避免污染 Todo / Schedule / Heartbeat 主流程。

预计修改：

- 保留当前 `src/plugins/opencli-codegen/` 作为网页读取验证桥。
- 新增 `src/plugins/external-context/` 作为新方向的隔离目录。
- Tauri 侧新增受控 wx-cli 命令，不开放任意 shell。
- Chat 增加临时“微信”测试模式，用于读取会话、定量回溯和搜索。
- 微信测试模式支持部署诊断命令：`部署`、`初始化`、`状态`、`日志 80`、`停止`。
- 暂不写入 Task、TimeBlock、Heartbeat 数据表。

验收标准：

- OpenCLI 能读取网页 Markdown。
- wx-cli 能列出会话、读取指定会话最近 N 条、按关键词搜索。
- 所有外部命令调用集中在 Provider / Tauri command 层。
- 删除测试入口后，不影响 V0-V2 主流程。

### V3.1 — External Context 基础模型

目标：定义网页和微信统一的上下文模型。

预计修改：

- 定义 `ExternalContext`、`ExternalSource`、`ExternalSourceRef`。
- 定义 `WeChatSession`、`WeChatMessage`、`WeChatMessageBatch`。
- 实现 `OpenCLIWebProvider` 和 `WxCliProvider` 的 TypeScript 封装。
- 实现规则版 `ExternalContextBuilder`。
- 网页解析模式从“生成页面代码”改为“生成网页上下文摘要”。
- 微信 history/search/new-messages 输出优先整理为会话上下文摘要。
- 用临时内存/本地存储保存测试结果，正式版本再落 SQLite。

验收标准：

- 网页和微信会话都能生成统一 `ExternalContext`。
- Builder 不依赖 Time Manager 的 Task/TimeBlock 模型。
- wx-cli 未安装或未初始化时，UI 给出明确提示。
- 不接 LLM 也可以生成摘要、关键点、来源引用和待办候选。

### V3.2 — 微信会话定向读取

目标：支持选择特定微信会话并做定量回顾。

预计修改：

- 会话列表：`wx.cmd sessions --json -n <limit>`。
- 历史读取：`wx.cmd history <chat> --json -n <limit> --since <date> --until <date>`。
- 搜索读取：`wx.cmd search <keyword> --json --in <chat> -n <limit>`。
- 支持轻量测试语法：
  - `部署`
  - `初始化`
  - `状态`
  - `日志 80`
  - `会话 20`
  - `读 xx群 100条`
  - `读 张三 2026-05-20`
  - `搜 关键词 in xx群`
  - `图片 xx群 10张`
  - `导出图片 <attachment_id> 到 test.jpg`
- 读取结果格式化为预览，不自动写入任务。

验收标准：

- 可以读取指定会话最近 N 条。
- 可以读取指定会话指定日期后的消息。
- 可以在指定会话内搜索关键词。
- UI 明确显示数据来自本机微信，不做全量导入。

### V3.2.1 — 微信图片附件提取

目标：先支持指定会话里的图片附件列表和单张图片导出。

预计修改：

- Tauri 侧接入 `wx.cmd attachments <chat> --kind image --json`。
- Tauri 侧接入 `wx.cmd extract <attachment_id> --output <path> --json`。
- 测试入口支持：
  - `图片 产品群 10张`
  - `图片 产品群 2026-05-20 到 2026-05-22 10张`
  - `导出图片 <attachment_id> 到 test.jpg`
  - `导出图片 <attachment_id> 到 test.jpg 覆盖`

验收标准：

- 可以列出指定会话的图片附件和不透明 `attachment_id`。
- 用户显式选择某个 `attachment_id` 后，才能导出图片。
- 首版不自动批量导出，不接 PDF / MOV / MP4。

### V3.3 — 微信 Watch + Cursor

目标：为未来 Heartbeat 全时监控打基础。

预计修改：

- 定义 `WeChatWatchTarget` 和 `WeChatWatchCursor`。
- 保存每个会话的 `lastSeenAt`、`lastSeenMessageId` 或 `lastSeenFingerprint`。
- 实现 `pollWatchTarget(watchId)`。
- 支持手动 poll，不先接自动后台循环。
- 支持去重和积压检测。

验收标准：

- 每个 watch target 可以独立维护读取进度。
- 重复 poll 不重复生成同一批消息。
- 单次读取超过上限时能标记 backlog。

### V3.4 — Agent 消费与任务排期

目标：上层智能体消费 ExternalContext，而不是直接读微信或网页。

预计修改：

- 实现 `ContextTaskEnhancer`。
- 从微信会话摘要中提取待办、截止时间、责任人和优先级。
- 将外部上下文作为 Agent Inbox 输入。
- 由更高一级 Agent 决定是否创建 Task、排期或更新计划。

验收标准：

- Time Manager 只依赖 External Context API。
- Agent 能说明任务建议来自哪个网页/哪段会话。
- 原始聊天记录不默认写入任务描述。

---

## 2. 预计文件修改清单

### 2.1 新增文件

```txt
src/plugins/external-context/index.ts
src/plugins/external-context/types.ts
src/plugins/external-context/services/ExternalContextService.ts
src/plugins/external-context/services/ExternalContextBuilder.ts
src/plugins/external-context/services/WeChatWatchService.ts
src/plugins/external-context/providers/OpenCLIWebProvider.ts
src/plugins/external-context/providers/WxCliProvider.ts
src/plugins/external-context/components/WeChatSessionPicker.tsx
src/plugins/external-context/components/WeChatHistoryPreview.tsx
src/plugins/external-context/repositories/*.ts
src/plugins/external-context/migrations/v5_external_context.ts
```

### 2.2 修改现有文件

```txt
src/db/migrations.ts
src-tauri/src/lib.rs
src/components/chat/ChatInput.tsx
src/store/chatStore.ts
src/agent/AgentService.ts
src/pages/SettingsPage.tsx
```

### 2.3 修改原则

- 当前阶段不改 `TodoForm`、`TaskService`、`ScheduleService`。
- `ChatInput` 只作为测试入口，后续可删除。
- `AgentService` 只负责协调，不直接调用 OpenCLI 或 wx-cli。
- OpenCLI / wx-cli 命令调用只存在于 Provider 或 Tauri 命令封装里。
- 微信数据默认只按用户选择的会话和范围读取，不做全量扫描。

---

## 3. 推荐实现顺序

1. 更新 V3 文档为 External Context。
2. 新增 wx-cli 受控 Tauri 命令。
3. 新增 `src/plugins/external-context` 类型和 Provider。
4. 接 Chat 测试模式。
5. 手动验证会话列表、history、search。
6. 设计 watch target / cursor。
7. 再决定是否落 SQLite。
8. 最后接 Agent Inbox / Task Enhancer。

这样可以保证每一步都有独立验证点。

---

## 4. 手动验证用例草案

### TC-V3-01 不填链接创建任务

前置条件：应用正常启动。

步骤：

1. 打开 Todo 新建表单。
2. 只填写任务标题。
3. 不填写相关链接。
4. 点击创建。

预期：

- 任务创建成功。
- 不产生 link source。
- V2 现有 Todo 流程不受影响。

### TC-V3-02 填链接创建任务

步骤：

1. 打开 Todo 新建表单。
2. 填写任务标题。
3. 填写相关链接。
4. 点击创建。

预期：

- 任务创建成功。
- 创建 LinkSource。
- 创建 Task 与 LinkSource 的绑定。
- 链接状态从 `pending/extracting` 变为 `ready` 或 `failed`。

### TC-V3-03 Chat 中创建带链接任务

输入：

```txt
帮我创建一个任务，看看这个候选人的网站 https://example.com
```

预期：

- Chat 创建任务。
- 链接被提取并绑定。
- 回复中包含“已保存链接上下文”或失败提示。

### TC-V3-04 查询任务链接摘要

输入：

```txt
这个任务绑定的网站主要讲了什么？
```

预期：

- Agent 找到最近任务。
- 返回 LinkContext summary 和 keyPoints。

### TC-V3-05 OpenCLI 不可用

步骤：

1. 禁用 OpenCLI 或使用不存在的命令。
2. 创建带链接任务。

预期：

- Task 仍创建成功。
- LinkSource 标记 failed。
- UI 不崩溃。

---

## 5. 风险点

### 5.1 现有 V1 Agent 是规则化 Agent

当前 Agent 不是 LLM，它不会自主规划多工具调用。因此 V3 首版不要假设 Agent 会自动完成复杂链路。

建议由 `AgentService` 编排 URL 预处理，把整理好的上下文传给对应工具。

### 5.2 OpenCLI 环境依赖

OpenCLI 可能依赖 Node 版本、Chrome/Chromium、Browser Bridge 扩展。必须提供 doctor 和 Mock Provider，否则开发/测试会不稳定。

### 5.3 网页内容隐私

如果读取的是登录态页面，保存内容前需要明确边界。首版建议只保存正文和摘要，不保存截图和敏感请求信息。

### 5.4 链接提取耗时

不要让用户在 TodoForm 里等待网页读取完成。先建任务，再异步处理链接。

---

## 6. 后续扩展

V3 完成后，可以继续扩展：

- LLM 版 `WebsiteDigestAgent`。
- LLM 版 `TodoBuilderAgent`。
- 根据 LinkContext 自动生成审阅 checklist。
- 根据候选人网站复杂度自动拆分任务。
- 支持多个链接共同构建一个任务。
- 支持刷新链接内容并提示内容变化。
- 支持删除某个任务时联动清理孤立 LinkSource。
