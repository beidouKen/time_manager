// ============================================================
// ConversationService.test.ts — V3.7 ConversationService 基础测试
//
// 使用 in-memory repository 实现，不依赖真实数据库。
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { ConversationService } from "@/services/ConversationService";
import type { IConversationRepository } from "@/repositories/interfaces/IConversationRepository";
import type { ConversationMessage, CreateMessageInput } from "@/types/agent.types";

// ─── In-memory IConversationRepository 实现 ──────────────────────────────────

class MemoryConversationRepository implements IConversationRepository {
  private messages: ConversationMessage[] = [];
  private idCounter = 0;

  async create(data: CreateMessageInput): Promise<ConversationMessage> {
    const created: ConversationMessage = {
      id: data.id ?? `msg-${++this.idCounter}`,
      role: data.role,
      content: data.content,
      metadata_json: data.metadata_json,
      created_at: new Date().toISOString(),
    };
    this.messages.push(created);
    return created;
  }

  async findAll(): Promise<ConversationMessage[]> {
    return [...this.messages];
  }

  async findRecent(limit: number): Promise<ConversationMessage[]> {
    if (limit <= 0) return [];
    return this.messages.slice(-limit);
  }

  async deleteAll(): Promise<void> {
    this.messages = [];
  }

  async updateMetadata(id: string, metadataJson: string): Promise<boolean> {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    this.messages[idx] = { ...this.messages[idx], metadata_json: metadataJson };
    return true;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ConversationService", () => {
  let service: ConversationService;

  beforeEach(() => {
    service = new ConversationService(new MemoryConversationRepository());
  });

  it("cs-1: createMessage → 返回消息并持久化", async () => {
    const msg = await service.createMessage({
      role: "user",
      content: "你好",
    });
    expect(msg.id).toBeTruthy();
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("你好");
    expect(msg.created_at).toBeTruthy();
  });

  it("cs-2: loadRecent → 按时序返回最近 N 条", async () => {
    await service.createMessage({ role: "user", content: "消息1" });
    await service.createMessage({ role: "assistant", content: "回复1" });
    await service.createMessage({ role: "user", content: "消息2" });

    const recent = await service.loadRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe("回复1");
    expect(recent[1].content).toBe("消息2");
  });

  it("cs-3: clearAll → 清空所有消息", async () => {
    await service.createMessage({ role: "user", content: "消息1" });
    await service.createMessage({ role: "assistant", content: "回复1" });

    await service.clearAll();

    const afterClear = await service.loadRecent(10);
    expect(afterClear).toHaveLength(0);
  });

  it("cs-4: metadata_json 正确保存和返回", async () => {
    const metadata = JSON.stringify({ intent: "create_task", confidence: 0.9 });
    await service.createMessage({
      role: "assistant",
      content: "已为你创建任务",
      metadata_json: metadata,
    });

    const loaded = await service.loadRecent(1);
    expect(loaded[0].metadata_json).toBe(metadata);
    const parsed = JSON.parse(loaded[0].metadata_json!);
    expect(parsed.intent).toBe("create_task");
  });

  it("cs-5: loadRecent limit 为 0 返回空数组", async () => {
    await service.createMessage({ role: "user", content: "消息" });
    const result = await service.loadRecent(0);
    expect(result).toHaveLength(0);
  });

  it("cs-6: 多条消息后 loadRecent 返回正确的最后 N 条", async () => {
    for (let i = 1; i <= 10; i++) {
      await service.createMessage({ role: "user", content: `消息${i}` });
    }
    const recent = await service.loadRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].content).toBe("消息8");
    expect(recent[1].content).toBe("消息9");
    expect(recent[2].content).toBe("消息10");
  });

  // ─── V3.7 P0-1: id 透传 + updateMessageMetadata ───────────────────────────

  it("cs-7: createMessage 携带客户端 id 时使用该 id", async () => {
    const fixedId = "fixed-id-abc";
    const created = await service.createMessage({
      id: fixedId,
      role: "assistant",
      content: "你好",
    });
    expect(created.id).toBe(fixedId);

    const loaded = await service.loadRecent(1);
    expect(loaded[0].id).toBe(fixedId);
  });

  it("cs-8: updateMessageMetadata 命中已存在行 → 返回 true 且 metadata 更新", async () => {
    const msg = await service.createMessage({
      id: "msg-pending",
      role: "assistant",
      content: "确认要删除吗？",
      metadata_json: JSON.stringify({
        confirmationId: "conf-1",
        resultType: "pending_confirmation",
      }),
    });

    const updated = await service.updateMessageMetadata(
      msg.id,
      JSON.stringify({ confirmationId: "conf-1", resultType: "success" })
    );
    expect(updated).toBe(true);

    const loaded = await service.loadRecent(1);
    const parsed = JSON.parse(loaded[0].metadata_json!);
    expect(parsed.resultType).toBe("success");
    expect(parsed.confirmationId).toBe("conf-1");
  });

  it("cs-9: updateMessageMetadata 行不存在 → 返回 false，不抛错", async () => {
    const ok = await service.updateMessageMetadata(
      "nonexistent-id",
      JSON.stringify({ resultType: "success" })
    );
    expect(ok).toBe(false);
  });
});
