import type {
  ExternalAttachmentRef,
  ExternalContentItem,
  ExternalContext,
  ExternalSourceRef,
  WeChatHistoryPayload,
  WeChatMessage,
} from "@/plugins/external-context/types";

const ACTION_PATTERNS = [
  /待办|todo|安排|计划|提醒|截止|deadline|ddl/i,
  /需要|麻烦|记得|别忘|帮我|请|可以.*吗|能不能|要不/,
  /今天|明天|后天|上午|下午|晚上|\d+[点:：]\d*/,
];

const NOISE_LINE_PATTERNS = [
  /^---+$/,
  /^[-\s]*$/,
  /^\[跳转到/,
  /^来自.+Wiki$/,
  /^检索自/,
  /^社区内容/,
  /^>?\s*原文链接[:：]/,
  /^Toggle Sidebar$/i,
  /^默认组织[:：]?/i,
  /^头像[:：]?/i,
  /^(登录|注册|编辑|刷新|讨论|更多|菜单|返回|展开|收起)$/i,
  /^(上一页|下一页|首页|末页|加载中|搜索|筛选)$/i,
];

const LOW_VALUE_LINK_TEXT_PATTERNS = [
  /^logo$/i,
  /^image$/i,
  /^avatar$/i,
  /^默认组织$/i,
  /^头像$/i,
  /^Toggle Sidebar$/i,
  /\.(png|jpe?g|gif|webp|svg|ico|avif)$/i,
];

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimLine(value: string, maxLength: number): string {
  const normalized = compactWhitespace(value);
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseMarkdownTitle(markdown: string, fallback: string): string {
  const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1];
  return compactWhitespace(firstHeading ?? fallback);
}

function stripMarkdownSyntax(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*[-*+>]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`|]/g, "")
    .replace(/^[-\s]+/, "");
}

function isAssetUrl(value: string): boolean {
  const url = value.toLowerCase();
  return (
    /\.(png|jpe?g|gif|webp|svg|ico|avif)(?:[?#].*)?$/.test(url) ||
    /[?&](x-expires|x-signature|signature|expires)=/.test(url) ||
    /(thumb|thumbnail|avatar|profile_image|organization_icon|logo)/.test(url)
  );
}

function isLowValueText(value: string): boolean {
  const text = compactWhitespace(value);
  if (!text) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (NOISE_LINE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (/^[-:：>]+$/.test(text)) return true;
  if (/^!\[/.test(text)) return true;
  if (/^原文链接[:：]?/i.test(text)) return true;
  return LOW_VALUE_LINK_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

function cleanMarkdownLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .map(stripMarkdownSyntax)
    .map((line) => compactWhitespace(line))
    .filter((line) => line.length >= 2)
    .filter((line) => !isLowValueText(line));
}

function extractWebSections(markdown: string): string[] {
  const headings = Array.from(markdown.matchAll(/^#{2,4}\s+(.+)$/gm))
    .map((match) => trimLine(stripMarkdownSyntax(match[1]), 80))
    .filter((heading) => !isLowValueText(heading));
  return unique(headings).slice(0, 8);
}

function extractLinks(markdown: string): Array<{ text: string; href: string }> {
  return Array.from(markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g))
    .map((match) => ({
      text: trimLine(stripMarkdownSyntax(match[1]), 80),
      href: match[2],
    }))
    .filter((link) => link.text && link.href)
    .filter((link) => !isAssetUrl(link.href))
    .filter((link) => !isLowValueText(link.text))
    .slice(0, 12);
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function summarizeLines(lines: string[]): string {
  const useful = lines
    .filter((line) => line.length >= 8)
    .filter((line) => !/^https?:\/\//.test(line))
    .slice(0, 3);
  return useful.length > 0
    ? useful.map((line) => trimLine(line, 120)).join(" / ")
    : "暂未提取到足够的正文内容。";
}

function messageText(message: WeChatMessage): string {
  return compactWhitespace(message.content ?? "");
}

function normalizeWeChatMessageType(type?: string): ExternalContentItem["type"] {
  const normalized = compactWhitespace(type ?? "").toLowerCase();
  if (["文本", "text"].includes(normalized)) return "text";
  if (["图片", "image", "img"].includes(normalized)) return "image";
  if (["语音", "voice", "audio"].includes(normalized)) return "voice";
  if (["视频", "video"].includes(normalized)) return "video";
  if (["文件", "file"].includes(normalized)) return "file";
  if (["链接", "link", "url"].includes(normalized)) return "link";
  if (["系统", "system"].includes(normalized)) return "system";
  return "unknown";
}

function messageFingerprint(message: WeChatMessage, index: number): string {
  return [
    message.local_id ?? index,
    message.sender ?? "",
    message.timestamp ?? message.time ?? "",
    messageText(message).slice(0, 80),
  ].join("|");
}

function buildAttachmentId(message: WeChatMessage, locator: string): string {
  return compactWhitespace(
    message.attachment_id ??
      message.file_id ??
      message.local_path ??
      message.path ??
      `wechat-attachment:${locator}`
  );
}

function buildAttachmentRef(
  message: WeChatMessage,
  locator: string,
  type: ExternalContentItem["type"]
): ExternalAttachmentRef | null {
  if (type !== "image" && type !== "voice" && type !== "video" && type !== "file") {
    return null;
  }

  const localPath = compactWhitespace(message.local_path ?? message.path ?? "");
  return {
    id: buildAttachmentId(message, locator),
    kind: type,
    status: localPath ? "available" : "metadata_only",
    sourceRefLocator: locator,
    filename: message.filename ?? message.file_name,
    mimeType: message.mime_type,
    sizeBytes: message.size,
    localPath: localPath || undefined,
    thumbnailPath: message.thumb_path,
    note: localPath ? undefined : "wx-cli history only exposed attachment metadata; extraction requires explicit user action.",
  };
}

function buildWeChatContent(messages: WeChatMessage[]): {
  content: ExternalContentItem[];
  attachments: ExternalAttachmentRef[];
} {
  const attachments: ExternalAttachmentRef[] = [];
  const content = messages.slice(0, 80).map((message, index) => {
    const locator = messageFingerprint(message, index);
    const type = normalizeWeChatMessageType(message.type);
    const attachment = buildAttachmentRef(message, locator, type);
    if (attachment) attachments.push(attachment);

    return {
      type,
      text: messageText(message) || undefined,
      sender: message.sender,
      sentAt: message.time,
      sourceRefLocator: locator,
      attachmentIds: attachment ? [attachment.id] : undefined,
    };
  });

  return { content, attachments };
}

function summarizeMessages(messages: WeChatMessage[]): string {
  const texts = messages.map(messageText).filter(Boolean);
  if (texts.length === 0) return "该批微信消息没有可整理的文本内容。";
  return texts.slice(0, 5).map((text) => trimLine(text, 80)).join(" / ");
}

function extractActionItemsFromMessages(messages: WeChatMessage[]): string[] {
  return messages
    .map(messageText)
    .filter((text) => ACTION_PATTERNS.some((pattern) => pattern.test(text)))
    .map((text) => trimLine(text, 120))
    .slice(0, 8);
}

function buildParticipantSummary(messages: WeChatMessage[]): string[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const sender = compactWhitespace(message.sender ?? "未知发送者");
    counts.set(sender, (counts.get(sender) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([sender, count]) => `${sender}: ${count}条`);
}

export class ExternalContextBuilder {
  buildWebPage(input: {
    url: string;
    fallbackTitle: string;
    markdown: string;
    command?: string;
  }): ExternalContext {
    const title = parseMarkdownTitle(input.markdown, input.fallbackTitle);
    const lines = cleanMarkdownLines(input.markdown);
    const sections = extractWebSections(input.markdown);
    const links = extractLinks(input.markdown);
    const keyPoints = unique([
      ...sections.map((section) => `页面章节：${section}`),
      ...lines.slice(0, 6).map((line) => trimLine(line, 120)),
    ]).slice(0, 10);

    return {
      sourceType: "webpage",
      title,
      summary: summarizeLines(lines),
      keyPoints,
      actionItems: [],
      sourceRefs: [
        {
          type: "url",
          label: title,
          locator: input.url,
        },
      ],
      metadata: {
        url: input.url,
        command: input.command,
        lineCount: lines.length,
        contentLines: lines.slice(0, 24),
        links,
      },
      confidence: lines.length > 0 ? 0.78 : 0.35,
    };
  }

  buildWeChatHistory(input: {
    rawJson: string;
    command?: string;
  }): ExternalContext | null {
    const payload = parseJson<WeChatHistoryPayload>(input.rawJson);
    if (!payload?.messages) return null;

    const messages = payload.messages;
    const { content, attachments } = buildWeChatContent(messages);
    const participants = buildParticipantSummary(messages);
    const typeCounts = messages.reduce<Record<string, number>>((acc, message) => {
      const type = message.type ?? "unknown";
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});
    const times = messages.map((message) => message.time).filter(Boolean);
    const keyPoints = unique([
      `会话类型：${payload.chat_type ?? "unknown"}`,
      `消息数：${payload.count ?? messages.length}`,
      participants.length > 0 ? `主要参与者：${participants.join("，")}` : "",
      `消息类型：${Object.entries(typeCounts)
        .map(([type, count]) => `${type} ${count}`)
        .join("，")}`,
      ...messages
        .map(messageText)
        .filter((text) => text.length >= 2)
        .slice(0, 8)
        .map((text) => trimLine(text, 100)),
    ]).slice(0, 12);

    const sourceRefs: ExternalSourceRef[] = messages.slice(0, 20).map((message, index) => ({
      type: "wechat_message",
      label: `${message.sender ?? "未知发送者"}: ${trimLine(messageText(message), 40)}`,
      locator: messageFingerprint(message, index),
      sentAt: message.time,
      sender: message.sender,
    }));

    return {
      sourceType: "wechat_conversation",
      title: payload.chat ? `微信会话：${payload.chat}` : "微信会话",
      summary: summarizeMessages(messages),
      keyPoints,
      content,
      attachments,
      actionItems: extractActionItemsFromMessages(messages),
      sourceRefs,
      metadata: {
        chat: payload.chat,
        chatType: payload.chat_type,
        isGroup: payload.is_group,
        command: input.command,
        attachmentCount: attachments.length,
        attachmentKinds: attachments.reduce<Record<string, number>>((acc, attachment) => {
          acc[attachment.kind] = (acc[attachment.kind] ?? 0) + 1;
          return acc;
        }, {}),
        timeRange:
          times.length > 0
            ? {
                from: times[times.length - 1],
                to: times[0],
              }
            : undefined,
      },
      confidence: messages.length > 0 ? 0.72 : 0.3,
    };
  }
}
