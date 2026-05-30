import { SqliteConfirmationRepository } from "@/repositories/sqlite/SqliteConfirmationRepository";
import type { IConfirmationRepository } from "@/repositories/interfaces/IConfirmationRepository";
import type {
  PendingConfirmation,
  CreateConfirmationInput,
} from "@/types/agent.types";
import { CreateConfirmationSchema } from "@/types/agent.types";

export class ConfirmationService {
  private repo: IConfirmationRepository;

  constructor(repo?: IConfirmationRepository) {
    this.repo = repo ?? new SqliteConfirmationRepository();
  }

  async createConfirmation(
    input: CreateConfirmationInput
  ): Promise<PendingConfirmation> {
    const validated = CreateConfirmationSchema.parse(input);
    return this.repo.create(validated);
  }

  async confirm(id: string): Promise<PendingConfirmation> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("确认记录不存在");
    if (existing.status !== "pending") {
      throw new Error(`确认记录状态为 ${existing.status}，无法确认`);
    }
    return this.repo.updateStatus(id, "confirmed");
  }

  async reject(id: string): Promise<PendingConfirmation> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("确认记录不存在");
    if (existing.status !== "pending") {
      throw new Error(`确认记录状态为 ${existing.status}，无法拒绝`);
    }
    return this.repo.updateStatus(id, "rejected");
  }

  async getPending(): Promise<PendingConfirmation[]> {
    await this.expireStale();
    return this.repo.findPending();
  }

  async getById(id: string): Promise<PendingConfirmation | null> {
    return this.repo.findById(id);
  }

  async expireStale(): Promise<number> {
    const now = new Date().toISOString();
    return this.repo.expireOld(now);
  }
}
