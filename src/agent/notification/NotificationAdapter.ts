// ============================================================
// NotificationAdapter.ts — 通知发送接口
//
// V5 阶段用于 create_reminder 触发 mock 通知，验证通知链路与建议链路的隔离。
// 禁止接入真实通知系统（OS 通知、邮件、Push 等）。
// ============================================================

export type NotificationChannel = "in_app" | "reminder" | "system";

export interface NotificationPayload {
  channel: NotificationChannel;
  title: string;
  message: string;
  /** ISO 8601 字符串，表示预定发送时间（可选，省略则立即发送）*/
  scheduledAt?: string;
  /** 关联的实体 ID（可选，用于溯源） */
  relatedId?: string;
}

export interface NotificationEvent extends NotificationPayload {
  /** 实际调用时间 */
  notifiedAt: string;
}

export interface NotificationAdapter {
  /** 发送（或调度）一条通知。 */
  notify(payload: NotificationPayload): Promise<void>;
}
