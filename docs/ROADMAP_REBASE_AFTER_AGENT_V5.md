# Roadmap Rebase After Agent V5

**日期**：2026-05-30  
**背景**：Agent 主线已提前完成到 Agent V5 mock-first 验证，但产品长期路线仍停留在 V0-V11 原始规划。本文用于重排版本语义，避免后续把 Agent 子版本误当成产品整体版本。

---

## 1. Rebase 结论

当前项目不能简单说“已经到 V5”。更准确的状态是：

> **产品核心能力完成到 V2.5，Agent 子线提前推进到 Agent V5 mock-first；下一阶段应进入 V3.7 Integration Freeze，而不是直接开启产品 V6。**

原因：

- V0 / V1 / V2 / V2.5 的本地时间管理、规则排程、Heartbeat、Tool Contract 已形成可运行闭环。
- Agent V3-V5 的 router、planning、batch/defer、mock memory/RAG 建议能力已经有测试证明。
- 原始产品 V4 OCR/外部日程导入尚未开始。
- 原始产品 V5 自适应排程记忆只有 mock-first 骨架，尚未生产化。
- V6 Planning RAG / Plan Mode、V7 Local Workspace Agent、V8 Executor Plugin System 仍未启动。

---

## 2. 版本命名重置

后续文档统一使用两条线：

| 线 | 含义 | 示例 |
|---|---|---|
| Product Version | 面向用户可用能力的整体产品版本 | Product V4 = OCR / Schedule Import |
| Agent Track Version | Agent 内部编排、测试、mock-first 能力版本 | Agent V5 = RecommendationHandler + mock memory/RAG |

禁止再把 `Agent V4 / Agent V5` 直接写成 `V4 / V5`，除非文档标题明确说明是 Agent Track。

---

## 3. 当前版本映射

| 原始路线版本 | 原定位 | 当前状态 | Rebase 后判断 |
|---|---|---|---|
| V0 | 本地时间管理闭环 | Done | Product V0 Done |
| V1 | 规则排程 | Partial | Product V1 Partial |
| V2 | Heartbeat + 执行反馈 | Done | Product V2 Done |
| V2.5 | Agent Tool Contract | Done | Product V2.5 Done |
| V3 | 自然语言 Agent Tooling MVP | Done | Agent Track 已覆盖并超前 |
| V4 | OCR / 外部日程导入 | Not started | Product V4 未开始 |
| V5 | 自适应排程记忆 | Partial | Agent V5 mock-first，不等于 Product V5 Done |
| V6 | Planning RAG / Plan Mode | Skeleton only | 仅有接口雏形 |
| V7 | Local Workspace Agent | Not started | 未开始 |
| V8 | Executor Plugin System | Not started | 未开始 |

---

## 4. 新阶段规划

### V3.7 Integration Freeze

**目标**：把提前完成的 Agent 主线安全并回产品主线。

范围：

- 修正版本语义和文档命名。
- 统一 Agent 操作边界：写操作必须 ToolRouter，读路径尽量工具化或明确标记为 read-only service access。
- 修复 `batch_action` / `defer_task` 确认后无法真正执行的问题。
- 增加 `ConversationService`，避免 `chatStore` 直接依赖 SQLite repository。
- 明确真实 LLM 是否进入主路，或者继续作为 experimental。

退出标准：

- `pnpm.cmd exec tsc --noEmit` 通过。
- `pnpm.cmd test` 通过。
- 审计项中 P0 偏离点关闭。
- 文档明确区分 Product Version 与 Agent Track Version。

### Product V4 Import Foundation

**目标**：恢复原始产品 V4，但先做低风险导入基础，不直接跳到 OCR。

建议顺序：

1. 手动粘贴文本日程解析。
2. ICS / CSV 导入。
3. 导入预览页。
4. 导入结果进入 PlanProposal，不直接写入 Timeline。
5. OCR 图片识别作为第二阶段接入。

退出标准：

- 导入内容能生成结构化候选。
- 用户可预览、编辑、确认或拒绝。
- 确认后通过 Tool / Service 写入 TimeBlock。
- 所有导入写操作有 ActionLog。

### Product V5 Production Memory

**目标**：把 Agent V5 mock memory/RAG 生产化。

建议顺序：

1. 定义本地行为记忆数据结构。
2. 复用或扩展 `agent_action_logs` 生成行为摘要。
3. 实现 `ProductionMemoryAdapter`。
4. 实现轻量 `ProductionRagAdapter`，先做本地摘要检索，不急于接向量库。
5. 将 `RecommendationHandler` 接入主 Agent 路径。

退出标准：

- 建议来源可追踪。
- suggestion 不写库。
- confirmation_required 必须走确认。
- 用户可清理或关闭记忆。

### Product V6 Plan Mode

**目标**：引入 Planning RAG / Plan Mode，让 Agent 从“执行单个请求”变成“提出可编辑计划”。

范围：

- Plan Mode UI。
- 多步骤候选计划。
- 每一步绑定 Tool / ConfirmationPolicy。
- 计划执行前可编辑、删除、重排。
- Agent 不直接批量写库。

退出标准：

- 多步骤计划默认只生成 proposal。
- 执行必须逐步或整体确认。
- 执行结果可追踪到 ActionLog / Trace。

### Product V7 Local Workspace Agent

**目标**：接入本地 workspace，但保持权限边界。

范围：

- 本地文件索引。
- 用户授权目录。
- 只读文件查询工具。
- 后续再考虑写文件工具。

退出标准：

- 默认只读。
- 每个 workspace action 有日志。
- 不影响 Time Manager 核心数据。

### Product V8 Executor Plugin System

**目标**：把内置 ToolRouter 演进为插件式 executor。

范围：

- Plugin manifest。
- Tool capability declaration。
- 权限策略。
- 插件安装 / 禁用。
- 插件测试 harness。

退出标准：

- 内置 tools 可作为 core plugin 表达。
- 第三方 executor 不能绕过 ConfirmationPolicy。
- 插件执行可审计。

---

## 5. V3.7 P0 修复清单

> 状态更新（2026-05-30）：V3.7 Integration Freeze 已全部完成。

| 优先级 | 项目 | 目标文件 | 状态 |
|---|---|---|---|
| P0 | 修复 batch/defer 确认执行 | `AgentService.executeActionList` + `PlanSafetyValidator` | ✅ **DONE** — confirm 后按 actions[] 顺序执行 |
| P0 | 统一 ConfirmationPolicy | `PlanSafetyValidator` 作为唯一闸门 | ✅ **DONE** — LLM/rule 输出都必经验证 |
| P0 | 版本文档重命名 | `reports/V3~V5_*.md` 头部 | ✅ **DONE** — 已添加 `Agent Track Version` 标识 |
| P0 | ConversationService | `src/services/ConversationService.ts` | ✅ **DONE** — chatStore 不再直连 SQLite |
| P0 | LLM 主路决策 | `CompositePlanner` + `LLMExperiencePlanner` | ✅ **DONE** — 选定方案 C-（LLM-first + 硬安全边界）|

---

## 6. V3.7 P1 收敛项

| 优先级 | 项目 | 说明 |
|---|---|---|
| P1 | 读路径工具化 | 将 `ActionPlanner` / `TimeManagementAgent` 里的直接 Service 查询收敛到 read-only tools 或 ReferenceResolver |
| P1 | ReferenceResolver | 统一处理“这个任务”“刚刚那个”“写文档任务”等引用 |
| P1 | RecommendationHandler 主路接入 | 让 V5 建议能力从测试独立处理器进入 Agent 可用路径 |
| P1 | Import design doc | 在开始 Product V4 前先写导入数据模型和确认流 |

---

## 7. 不建议现在做的事

- 不建议直接开启 Product V6 / V7 / V8。
- 不建议立刻接 LangGraph autonomous workflow。
- 不建议直接上真实向量库。
- 不建议让 OCR 结果直接写入数据库。
- 不建议继续扩大 Agent 测试矩阵，而不先修复确认执行和版本语义。

---

## 8. 推荐下一步执行顺序

1. 完成 V3.7 Integration Freeze。
2. 给当前所有 V3/V4/V5 Agent 文档补上 `Agent Track` 标识。
3. 修复 batch/defer confirmation 后执行闭环。
4. 增加 ConversationService。
5. 决定真实 LLM 是否进入主路。
6. 写 Product V4 Import Foundation 设计文档。
7. 开始文本/ICS/CSV 导入，而不是先做 OCR。

---

## 9. 新路线摘要

```text
当前实际状态
  Product V2.5 Done
  Agent Track V5 Mock-First Done

下一阶段
  V3.7 Integration Freeze

之后
  Product V4 Import Foundation
  Product V5 Production Memory
  Product V6 Plan Mode
  Product V7 Local Workspace Agent
  Product V8 Executor Plugin System
```

---

## 10. 成功标准

Rebase 成功的标志不是新增多少功能，而是：

- 后续文档不会再混淆 Product V5 和 Agent V5。
- 所有写操作都能回答“谁决定、谁确认、谁执行、谁记录”。
- Agent 能力可以逐步接入真实 LLM / Memory / Import，而不破坏 V0-V2.5 的稳定闭环。
- Heartbeat 继续是 trigger engine，不变成隐藏的大脑。
- Task / TimeBlock / Timeline 仍是产品核心实体，不被 Agent 计划对象污染。

