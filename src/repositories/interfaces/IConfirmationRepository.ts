import type {
  PendingConfirmation,
  CreateConfirmationInput,
  ConfirmationStatus,
} from "@/types/agent.types";

export interface IConfirmationRepository {
  create(data: CreateConfirmationInput): Promise<PendingConfirmation>;
  findById(id: string): Promise<PendingConfirmation | null>;
  findPending(): Promise<PendingConfirmation[]>;
  updateStatus(id: string, status: ConfirmationStatus): Promise<PendingConfirmation>;
  expireOld(beforeDate: string): Promise<number>;
}
