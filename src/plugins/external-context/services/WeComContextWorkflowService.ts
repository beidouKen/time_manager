import { WeComCliProvider } from "@/plugins/external-context/providers/WeComCliProvider";
import type { CliCommandOutput, ExternalContext, ExternalContentItem } from "@/plugins/external-context/types";

const SAMPLE_WECOM_OUTPUT = {
  chat: "演示项目群",
  chat_type: "group",
  messages: [
    {
      id: "demo-001",
      sender: "林同学",
      time: "2026-05-30 10:00",
      type: "text",
      content: "下午把网页上下文插件的演示链路跑通一下。",
    },
    {
      id: "demo-002",
      sender: "我",
      time: "2026-05-30 10:02",
      type: "image",
      content: "[图片] 插件输出结构截图",
      attachment_id: "demo-image-001",
    },
    {
      id: "demo-003",
      sender: "林同学",
      time: "2026-05-30 10:04",
      type: "text",
      content: "演示时先不要碰个人微信，企业微信用 mock 数据也可以。",
    },
  ],
};

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function findArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of ["messages", "items", "list", "data", "results"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
    const nested = asRecord(candidate);
    for (const nestedKey of ["messages", "items", "list", "results"]) {
      if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
    }
  }
  return [];
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return compactWhitespace(value);
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function buildWeComContext(raw: unknown, command: string): ExternalContext {
  const root = asRecord(raw);
  const messages = findArray(raw).map(asRecord);
  const chat = stringField(root, ["chat", "chat_name", "room_name", "conversation", "name"]) ?? "企业微信会话";

  const content: ExternalContentItem[] = messages.slice(0, 80).map((message, index) => {
    const type = stringField(message, ["type", "msgtype", "message_type"]) ?? "text";
    const text = stringField(message, ["content", "text", "summary", "title", "body"]) ?? "";
    const sender = stringField(message, ["sender", "from", "from_name", "userid", "user"]);
    const sentAt = stringField(message, ["time", "sent_at", "send_time", "created_at", "timestamp"]);
    const id = stringField(message, ["id", "msgid", "message_id", "local_id"]) ?? `wecom-${index}`;
    const attachmentId = stringField(message, ["attachment_id", "media_id", "file_id"]);

    return {
      type: type === "image" ? "image" : type === "file" ? "file" : type === "video" ? "video" : "text",
      text: text || undefined,
      sender,
      sentAt,
      sourceRefLocator: id,
      attachmentIds: attachmentId ? [attachmentId] : undefined,
    };
  });

  const keyTexts = content
    .map((item) => item.text)
    .filter((text): text is string => Boolean(text))
    .slice(0, 8);

  return {
    sourceType: "wecom_conversation",
    title: `企业微信会话：${chat}`,
    summary:
      keyTexts.length > 0
        ? keyTexts.slice(0, 3).join(" / ")
        : "企业微信命令已返回数据，但暂未识别到可整理的文本消息。",
    keyPoints: [
      `消息数：${messages.length}`,
      ...keyTexts.map((text) => compactWhitespace(text).slice(0, 120)),
    ],
    content,
    attachments: content
      .filter((item) => item.attachmentIds?.length)
      .flatMap((item) =>
        (item.attachmentIds ?? []).map((id) => ({
          id,
          kind: item.type === "image" || item.type === "video" || item.type === "file" ? item.type : "file",
          status: "metadata_only" as const,
          sourceRefLocator: item.sourceRefLocator ?? id,
          note: "企业微信附件默认只进入引用；需要图片/OCR/文件内容时再调用附件解析工具。",
        }))
      ),
    actionItems: keyTexts.filter((text) => /需要|下午|明天|安排|演示|任务|deadline|ddl/i.test(text)),
    sourceRefs: content.slice(0, 20).map((item, index) => ({
      type: "wecom_message",
      label: `${item.sender ?? "未知发送者"}: ${item.text ?? item.type}`,
      locator: item.sourceRefLocator ?? `wecom-${index}`,
      sentAt: item.sentAt,
      sender: item.sender,
    })),
    metadata: {
      provider: command === "mock" ? "mock-wecom" : "wecom-cli",
      command,
      rawShape: Array.isArray(raw) ? "array" : "object",
    },
    confidence: content.length > 0 ? 0.7 : 0.35,
  };
}

function formatPayload(context: ExternalContext): string {
  const payload = {
    type: "external_context",
    version: "v3.wecom.v1",
    sourceType: context.sourceType,
    title: context.title,
    summary: context.summary,
    keyPoints: context.keyPoints,
    content: context.content ?? [],
    attachments: context.attachments ?? [],
    actionItems: context.actionItems,
    sourceRefs: context.sourceRefs,
    metadata: context.metadata,
  };

  return ["ExternalContext payload:", "", "```json", JSON.stringify(payload, null, 2), "```"].join("\n");
}

function formatCliOutput(title: string, output: CliCommandOutput): string {
  const raw = output.stdout.trim() || output.stderr.trim() || "{}";
  const parsed = parseJson(raw);
  if (parsed) return formatPayload(buildWeComContext(parsed, output.command));

  return [
    title,
    "",
    `命令：${output.command}`,
    `退出码：${output.exit_code ?? "-"}`,
    "",
    "```text",
    raw.slice(0, 6000),
    "```",
  ].join("\n");
}

function parseCallInput(input: string): { category: string; method: string; args: Record<string, unknown> } {
  const rest = input.replace(/^(调用|call)\s*/i, "").trim();
  const match = rest.match(/^(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/);
  if (!match) {
    throw new Error('请输入：调用 <category> <method> {"limit":10}');
  }

  const argsText = match[3]?.trim() || "{}";
  const args = parseJson(argsText);
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("调用参数必须是 JSON object。");
  }

  return {
    category: match[1],
    method: match[2],
    args: args as Record<string, unknown>,
  };
}

export class WeComContextWorkflowService {
  private provider: WeComCliProvider;

  constructor(provider?: WeComCliProvider) {
    this.provider = provider ?? new WeComCliProvider();
  }

  async generateMessage(input: string): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed || /^(帮助|help|部署|workflow)$/i.test(trimmed)) {
      return this.helpMessage();
    }

    if (/^(样例|mock|demo)$/i.test(trimmed)) {
      return formatPayload(buildWeComContext(SAMPLE_WECOM_OUTPUT, "mock"));
    }

    if (/^(检查|doctor|状态|help-cli)$/i.test(trimmed)) {
      try {
        const output = await this.provider.help();
        return formatCliOutput("wecom-cli help", output);
      } catch (error) {
        return [
          "wecom-cli 暂不可用。",
          "",
          `错误：${String(error)}`,
          "",
          "当前工作流仍可用 `样例` 命令验证 ExternalContext payload。",
          "",
          this.helpMessage(),
        ].join("\n");
      }
    }

    if (/^(调用|call)\s+/i.test(trimmed)) {
      const parsed = parseCallInput(trimmed);
      const output = await this.provider.call(parsed);
      return formatCliOutput(`wecom-cli ${parsed.category} ${parsed.method}`, output);
    }

    return this.helpMessage();
  }

  private helpMessage(): string {
    return [
      "企业微信 External Context 工作流：",
      "",
      "```text",
      "帮助",
      "检查",
      "样例",
      "调用 <category> <method> {\"limit\":10}",
      "```",
      "",
      "说明：",
      "- `样例` 不依赖手机企业微信登录，用 mock 消息验证 payload。",
      "- `检查` 调用 wecom-cli --help，用于确认本机安装/配置状态。",
      "- `调用` 走只读保护的 wecom-cli 调用壳，当前会拦截 send/create/update/delete 等写操作。",
      "- 真实企业微信扫码失败时，先用 `样例` 完成演示链路；登录成功后再替换为真实调用。",
    ].join("\n");
  }
}
