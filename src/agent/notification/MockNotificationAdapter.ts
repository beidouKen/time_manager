// ============================================================
// MockNotificationAdapter.ts — 进程内 NotificationAdapter 实现
//
// 仅收集通知事件到内存数组，不发送任何真实通知。
// drain() 返回并清空事件队列，供测试断言使用。
// ============================================================

import type {
  NotificationAdapter,
  NotificationEvent,
  NotificationPayload,
} from "@/agent/notification/NotificationAdapter";

export class MockNotificationAdapter implements NotificationAdapter {
  private events: NotificationEvent[] = [];

  async notify(payload: NotificationPayload): Promise<void> {
    this.events.push({
      ...payload,
      notifiedAt: new Date().toISOString(),
    });
  }

  /** 返回所有事件并清空队列（供测试断言后重置） */
  drain(): NotificationEvent[] {
    const events = [...this.events];
    this.events = [];
    return events;
  }

  /** 查看当前队列（不清空） */
  peek(): NotificationEvent[] {
    return [...this.events];
  }

  /** 清空队列（供 beforeEach 使用） */
  clear(): void {
    this.events = [];
  }
}
