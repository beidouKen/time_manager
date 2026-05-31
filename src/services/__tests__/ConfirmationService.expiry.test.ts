// ============================================================
// ConfirmationService.expiry.test.ts
//
// 验证 #3 修复：pending 但已过 expires_at 的确认记录
// → confirm() 抛错，DB 状态被更新为 expired
// ============================================================

import { describe, it, expect } from "vitest";
import { ConfirmationService } from "@/services/ConfirmationService";
import type { IConfirmationRepository } from "@/repositories/interfaces/IConfirmationRepository";
import type {
  PendingConfirmation,
  CreateConfirmationInput,
  ConfirmationStatus,
} from "@/types/agent.types";

// ─── 进程内 ConfirmationRepository ────────────────────────────────────────────

class MemoryConfirmationRepository implements IConfirmationRepository {
  records: PendingConfirmation[] = [];
  private seq = 1;

  async create(data: CreateConfirmationInput): Promise<PendingConfirmation> {
    const record: PendingConfirmation = {
      id: `conf-${this.seq++}`,
      action_type: data.action_type,
      tool_name: data.tool_name,
      tool_args_json: data.tool_args_json,
      description: data.description,
      risk_level: data.risk_level ?? "medium",
      status: "pending",
      created_at: new Date().toISOString(),
      expires_at: data.expires_at,
    };
    this.records.push(record);
    return record;
  }

  async findById(id: string): Promise<PendingConfirmation | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }

  async findPending(): Promise<PendingConfirmation[]> {
    return this.records.filter((r) => r.status === "pending");
  }

  async updateStatus(
    id: string,
    status: ConfirmationStatus
  ): Promise<PendingConfirmation> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error("not found");
    record.status = status;
    return record;
  }

  async expireOld(beforeDate: string): Promise<number> {
    let count = 0;
    for (const r of this.records) {
      if (r.status === "pending" && r.expires_at && r.expires_at < beforeDate) {
        r.status = "expired";
        count++;
      }
    }
    return count;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ConfirmationService — #3 过期确认修复", () => {
  it("confirm() 对已过期 pending 确认 → 抛错且 status 改为 expired", async () => {
    const repo = new MemoryConfirmationRepository();
    const service = new ConfirmationService(repo);

    // 手动注入一条已过期的确认记录
    const pastTime = new Date(Date.now() - 60_000).toISOString(); // 1分钟前
    const record = await repo.create({
      action_type: "delete_task",
      tool_name: "delete_task",
      tool_args_json: "{}",
      risk_level: "high",
      expires_at: pastTime,
    });

    await expect(service.confirm(record.id)).rejects.toThrow("已过期");

    const updated = await repo.findById(record.id);
    expect(updated?.status).toBe("expired");
  });

  it("confirm() 对未过期 pending 确认 → 成功，status 改为 confirmed", async () => {
    const repo = new MemoryConfirmationRepository();
    const service = new ConfirmationService(repo);

    const futureTime = new Date(Date.now() + 60_000).toISOString(); // 1分钟后
    const record = await repo.create({
      action_type: "delete_task",
      tool_name: "delete_task",
      tool_args_json: "{}",
      risk_level: "high",
      expires_at: futureTime,
    });

    const result = await service.confirm(record.id);
    expect(result.status).toBe("confirmed");
  });

  it("confirm() 对 expires_at 缺失的确认 → 成功（不强制过期）", async () => {
    const repo = new MemoryConfirmationRepository();
    const service = new ConfirmationService(repo);

    const record = await repo.create({
      action_type: "delete_task",
      tool_name: "delete_task",
      tool_args_json: "{}",
    });
    // 不设 expires_at

    const result = await service.confirm(record.id);
    expect(result.status).toBe("confirmed");
  });

  it("confirm() 对已非 pending 状态（confirmed）→ 抛错", async () => {
    const repo = new MemoryConfirmationRepository();
    const service = new ConfirmationService(repo);

    const record = await repo.create({
      action_type: "delete_task",
      tool_name: "delete_task",
      tool_args_json: "{}",
    });
    await repo.updateStatus(record.id, "confirmed");

    await expect(service.confirm(record.id)).rejects.toThrow("confirmed");
  });

  it("reject() 对已过期 pending 确认 → 抛错且 status 改为 expired", async () => {
    const repo = new MemoryConfirmationRepository();
    const service = new ConfirmationService(repo);

    const pastTime = new Date(Date.now() - 60_000).toISOString();
    const record = await repo.create({
      action_type: "delete_task",
      tool_name: "delete_task",
      tool_args_json: "{}",
      expires_at: pastTime,
    });

    await expect(service.reject(record.id)).rejects.toThrow("已过期");

    const updated = await repo.findById(record.id);
    expect(updated?.status).toBe("expired");
  });
});
