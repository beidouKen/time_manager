import { WxCliProvider } from "@/plugins/external-context/providers/WxCliProvider";
import { ExternalContextBuilder } from "@/plugins/external-context/services/ExternalContextBuilder";
import type { CliCommandOutput } from "@/plugins/external-context/types";

const MAX_OUTPUT_CHARS = 6000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stripToken(input: string, token: string): string {
  return input.replace(token, " ").replace(/\s+/g, " ").trim();
}

function startsWithCommand(input: string, commands: string[]): boolean {
  return commands.some((command) => {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}(?:\\s|$)`, "i").test(input);
  });
}

function parseHistoryInput(input: string): {
  chat: string;
  limit?: number;
  since?: string;
  until?: string;
} {
  let rest = input.replace(/^(读|读取|history)\s*/i, "").trim();
  const limitMatch = rest.match(/(\d+)\s*条?/);
  const limit = limitMatch ? parsePositiveInt(limitMatch[1], 20) : undefined;
  if (limitMatch) rest = stripToken(rest, limitMatch[0]);

  const dates = Array.from(rest.matchAll(/\d{4}-\d{2}-\d{2}/g)).map((m) => m[0]);
  for (const date of dates) rest = stripToken(rest, date);
  rest = rest.replace(/\bto\b|到|至/g, " ").replace(/\s+/g, " ").trim();

  if (!rest) {
    throw new Error("请指定微信会话，例如：读 产品群 100条");
  }

  return {
    chat: rest,
    limit,
    since: dates[0],
    until: dates[1],
  };
}

function parseSearchInput(input: string): {
  keyword: string;
  chat?: string;
  limit?: number;
} {
  let rest = input.replace(/^(搜|搜索|search)\s*/i, "").trim();
  const limitMatch = rest.match(/(\d+)\s*条?/);
  const limit = limitMatch ? parsePositiveInt(limitMatch[1], 20) : undefined;
  if (limitMatch) rest = stripToken(rest, limitMatch[0]);

  const inMatch = rest.match(/\s+(?:in|在)\s+(.+)$/i);
  const chat = inMatch?.[1]?.trim();
  if (inMatch) rest = rest.slice(0, inMatch.index).trim();

  if (!rest) {
    throw new Error("请指定搜索关键词，例如：搜 会议 in 产品群");
  }

  return { keyword: rest, chat, limit };
}

function parseImageInput(input: string): {
  chat: string;
  limit?: number;
  since?: string;
  until?: string;
} {
  let rest = input.replace(/^(图片|附件|images?)\s*/i, "").trim();
  const limitMatch = rest.match(/(\d+)\s*(?:张|个|条)?/);
  const limit = limitMatch ? parsePositiveInt(limitMatch[1], 10) : undefined;
  if (limitMatch) rest = stripToken(rest, limitMatch[0]);

  const dates = Array.from(rest.matchAll(/\d{4}-\d{2}-\d{2}/g)).map((m) => m[0]);
  for (const date of dates) rest = stripToken(rest, date);
  rest = rest.replace(/\bto\b|到|至/g, " ").replace(/\s+/g, " ").trim();

  if (!rest) {
    throw new Error("请指定微信会话，例如：图片 产品群 10张");
  }

  return {
    chat: rest,
    limit,
    since: dates[0],
    until: dates[1],
  };
}

function parseExtractImageInput(input: string): {
  attachmentId: string;
  output: string;
  overwrite: boolean;
} {
  const rest = input.replace(/^(导出图片|提取图片|extract-image)\s*/i, "").trim();
  const match = rest.match(/^(\S+)\s+(?:到|to|-o|--output)\s+(.+)$/i);
  if (!match) {
    throw new Error("请输入：导出图片 <attachment_id> 到 <输出路径>");
  }

  const output = match[2].replace(/\s+覆盖$/i, "").trim();
  return {
    attachmentId: match[1],
    output,
    overwrite: /覆盖|overwrite/i.test(match[2]),
  };
}

function formatOutput(title: string, output: CliCommandOutput): string {
  const body = output.stdout.trim() || output.stderr.trim() || "wx-cli 未返回内容。";
  const clipped =
    body.length > MAX_OUTPUT_CHARS
      ? `${body.slice(0, MAX_OUTPUT_CHARS)}\n\n...已截断，完整内容仍在 wx-cli 输出中。`
      : body;

  return [
    title,
    "",
    `命令：${output.command}`,
    `退出码：${output.exit_code ?? "-"}`,
    "",
    "```json",
    clipped,
    "```",
  ].join("\n");
}

export class WeChatContextTestService {
  private provider: WxCliProvider;
  private builder: ExternalContextBuilder;

  constructor(provider?: WxCliProvider, builder?: ExternalContextBuilder) {
    this.provider = provider ?? new WxCliProvider();
    this.builder = builder ?? new ExternalContextBuilder();
  }

  async generateMessage(input: string): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) {
      return this.helpMessage();
    }

    try {
      if (startsWithCommand(trimmed, ["部署", "帮助", "help"])) {
        return this.helpMessage();
      }

      if (startsWithCommand(trimmed, ["初始化", "init"])) {
        const output = await this.provider.init(/force|强制/i.test(trimmed));
        return formatOutput("wx-cli 初始化结果", output);
      }

      if (startsWithCommand(trimmed, ["状态", "daemon", "status"])) {
        const output = await this.provider.daemonStatus();
        return formatOutput("wx-daemon 状态", output);
      }

      if (startsWithCommand(trimmed, ["停止", "stop"])) {
        const output = await this.provider.daemonStop();
        return formatOutput("wx-daemon 停止结果", output);
      }

      if (startsWithCommand(trimmed, ["日志", "logs"])) {
        const limit = parsePositiveInt(trimmed.match(/\d+/)?.[0], 50);
        const output = await this.provider.daemonLogs(limit);
        return formatOutput(`wx-daemon 最近 ${limit} 行日志`, output);
      }

      if (startsWithCommand(trimmed, ["会话", "sessions"])) {
        const limit = parsePositiveInt(trimmed.match(/\d+/)?.[0], 10);
        const output = await this.provider.listSessions(limit);
        return formatOutput(`最近 ${limit} 个微信会话`, output);
      }

      if (startsWithCommand(trimmed, ["未读", "unread"])) {
        const limit = parsePositiveInt(trimmed.match(/\d+/)?.[0], 10);
        const output = await this.provider.listUnread(limit);
        return formatOutput(`最近 ${limit} 个未读微信会话`, output);
      }

      if (startsWithCommand(trimmed, ["新增", "新消息", "new"])) {
        const limit = parsePositiveInt(trimmed.match(/\d+/)?.[0], 50);
        const output = await this.provider.readNewMessages(limit);
        return this.formatContextOrOutput(`最近 ${limit} 条新增微信消息`, output);
      }

      if (startsWithCommand(trimmed, ["图片", "附件", "image", "images"])) {
        const parsed = parseImageInput(trimmed);
        const output = await this.provider.listImageAttachments(parsed);
        return formatOutput(`列出「${parsed.chat}」的图片附件`, output);
      }

      if (startsWithCommand(trimmed, ["导出图片", "提取图片", "extract-image"])) {
        const parsed = parseExtractImageInput(trimmed);
        const output = await this.provider.extractAttachment(parsed);
        return formatOutput(`导出图片到 ${parsed.output}`, output);
      }

      if (startsWithCommand(trimmed, ["搜", "搜索", "search"])) {
        const parsed = parseSearchInput(trimmed);
        const output = await this.provider.searchMessages(parsed);
        return this.formatContextOrOutput(
          parsed.chat
            ? `在「${parsed.chat}」中搜索「${parsed.keyword}」`
            : `搜索微信消息「${parsed.keyword}」`,
          output
        );
      }

      if (startsWithCommand(trimmed, ["读", "读取", "history"])) {
        const parsed = parseHistoryInput(trimmed);
        const output = await this.provider.readHistory(parsed);
        return this.formatContextOrOutput(`读取「${parsed.chat}」的微信消息`, output);
      }

      return this.helpMessage();
    } catch (error) {
      return `微信读取失败：${String(error)}\n\n${this.helpMessage()}`;
    }
  }

  private helpMessage(): string {
    return [
      "微信测试模式支持这些指令：",
      "",
      "```text",
      "部署",
      "初始化",
      "状态",
      "日志 80",
      "停止",
      "会话 10",
      "未读 10",
      "新增 50",
      "读 产品群 20条",
      "读 张三 2026-05-20",
      "读 项目群 2026-05-20 到 2026-05-22 200条",
      "搜 会议 in 产品群",
      "图片 产品群 10张",
      "图片 产品群 2026-05-20 到 2026-05-22 10张",
      "导出图片 <attachment_id> 到 test.jpg",
      "导出图片 <attachment_id> 到 test.jpg 覆盖",
      "```",
      "",
      "当前入口只做测试读取，不写入任务、不全量导入微信数据。",
      "安全边界：当前测试入口已禁用 `初始化 force`，未登录微信时不要强制重扫密钥。",
      "注意：Tauri 应用必须用 `pnpm.cmd tauri dev` 启动；只跑 `pnpm dev` 时无法调用本地 wx-cli。",
    ].join("\n");
  }

  private formatContextOrOutput(title: string, output: CliCommandOutput): string {
    const rawJson = output.stdout.trim();
    const context = this.builder.buildWeChatHistory({
      rawJson,
      command: output.command,
    });

    if (!context) {
      return formatOutput(title, output);
    }

    const payload = {
      type: "external_context",
      version: "v3.wechat.v1",
      sourceType: context.sourceType,
      title: context.title,
      summary: context.summary,
      keyPoints: context.keyPoints,
      content: context.content ?? [],
      attachments: context.attachments ?? [],
      actionItems: context.actionItems,
      sourceRefs: context.sourceRefs,
      metadata: {
        provider: "wx-cli",
        chat: context.metadata.chat,
        chatType: context.metadata.chatType,
        isGroup: context.metadata.isGroup,
        timeRange: context.metadata.timeRange,
        attachmentCount: context.metadata.attachmentCount,
        attachmentKinds: context.metadata.attachmentKinds,
        command: output.command,
      },
    };

    return [
      `${title} -> ExternalContext payload:`,
      "",
      "```json",
      JSON.stringify(payload, null, 2),
      "```",
    ].join("\n");
  }
}
