export interface CliCommandOutput {
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

export interface WeComCliCallInput {
  category: string;
  method: string;
  args?: Record<string, unknown>;
}

export type WeChatMessageType =
  | "text"
  | "image"
  | "voice"
  | "video"
  | "sticker"
  | "location"
  | "link"
  | "file"
  | "call"
  | "system";

export type ExternalContextSourceType = "webpage" | "wechat_conversation" | "wecom_conversation";
export type ExternalAttachmentKind = "image" | "voice" | "video" | "file";
export type ExternalAttachmentStatus = "metadata_only" | "available" | "exported" | "missing";

export interface ExternalAttachmentRef {
  id: string;
  kind: ExternalAttachmentKind;
  status: ExternalAttachmentStatus;
  sourceRefLocator: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  localPath?: string;
  thumbnailPath?: string;
  note?: string;
}

export interface ExternalContentItem {
  type: "text" | "image" | "voice" | "video" | "file" | "link" | "system" | "unknown";
  text?: string;
  sender?: string;
  sentAt?: string;
  sourceRefLocator?: string;
  attachmentIds?: string[];
}

export interface ExternalContext {
  sourceType: ExternalContextSourceType;
  title: string;
  summary: string;
  keyPoints: string[];
  content?: ExternalContentItem[];
  attachments?: ExternalAttachmentRef[];
  actionItems: string[];
  sourceRefs: ExternalSourceRef[];
  metadata: Record<string, unknown>;
  confidence: number;
}

export interface ExternalSourceRef {
  type: "url" | "wechat_message" | "wecom_message";
  label: string;
  locator: string;
  sentAt?: string;
  sender?: string;
}

export interface WeChatMessage {
  content: string;
  local_id?: number;
  sender?: string;
  time?: string;
  timestamp?: number;
  type?: string;
  attachment_id?: string;
  file_id?: string;
  filename?: string;
  file_name?: string;
  mime_type?: string;
  size?: number;
  path?: string;
  local_path?: string;
  thumb_path?: string;
}

export interface WeChatHistoryPayload {
  chat?: string;
  chat_type?: string;
  count?: number;
  is_group?: boolean;
  messages?: WeChatMessage[];
}

export interface WeChatHistoryInput {
  chat: string;
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
  messageType?: WeChatMessageType;
}

export interface WeChatSearchInput {
  keyword: string;
  chat?: string;
  limit?: number;
  since?: string;
  until?: string;
  messageType?: WeChatMessageType;
}

export interface WeChatImageAttachmentInput {
  chat: string;
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
}

export interface WeChatExtractAttachmentInput {
  attachmentId: string;
  output: string;
  overwrite?: boolean;
}

export interface WeChatWatchTarget {
  id: string;
  chatName: string;
  enabled: boolean;
  pollIntervalSeconds: number;
  defaultLookbackMinutes: number;
  maxMessagesPerPoll: number;
  createdAt: string;
  updatedAt: string;
}

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
