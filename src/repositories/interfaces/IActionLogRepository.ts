import type {
  ActionLog,
  CreateActionLogInput,
  UpdateActionLogInput,
} from "@/types/agent.types";

export interface IActionLogRepository {
  create(data: CreateActionLogInput): Promise<ActionLog>;
  findById(id: string): Promise<ActionLog | null>;
  findAll(limit?: number): Promise<ActionLog[]>;
  update(id: string, data: UpdateActionLogInput): Promise<ActionLog>;
}
