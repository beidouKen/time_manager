import { invoke } from "@tauri-apps/api/core";
import type {
  CliCommandOutput,
  WeChatExtractAttachmentInput,
  WeChatHistoryInput,
  WeChatImageAttachmentInput,
  WeChatSearchInput,
} from "@/plugins/external-context/types";

export class WxCliProvider {
  async init(force = false): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_init", { force });
  }

  async daemonStatus(): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_daemon_status");
  }

  async daemonStop(): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_daemon_stop");
  }

  async daemonLogs(lines = 50): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_daemon_logs", { lines });
  }

  async listSessions(limit = 20): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_sessions", { limit });
  }

  async readHistory(input: WeChatHistoryInput): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_history", {
      chat: input.chat,
      limit: input.limit,
      offset: input.offset,
      since: input.since,
      until: input.until,
      messageType: input.messageType,
    });
  }

  async searchMessages(input: WeChatSearchInput): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_search", {
      keyword: input.keyword,
      chat: input.chat,
      limit: input.limit,
      since: input.since,
      until: input.until,
      messageType: input.messageType,
    });
  }

  async listUnread(limit = 20, filter = "private,group"): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_unread", { limit, filter });
  }

  async readNewMessages(limit = 200): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_new_messages", { limit });
  }

  async listImageAttachments(input: WeChatImageAttachmentInput): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_attachments", {
      chat: input.chat,
      limit: input.limit,
      offset: input.offset,
      since: input.since,
      until: input.until,
    });
  }

  async extractAttachment(input: WeChatExtractAttachmentInput): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wx_cli_extract_attachment", {
      attachmentId: input.attachmentId,
      output: input.output,
      overwrite: input.overwrite,
    });
  }
}
