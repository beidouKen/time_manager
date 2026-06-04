// ============================================================
// ContextTraceService.ts — C6 Agent 决策链路 trace 服务
//
// 职责：
// - recordStep / recordSteps：写入 agent_trace_steps 表（append-only）
// - findByTurn / findByMessage / findByConversation / findLatestByConversation：查询
// - countByStepType：统计指标（dev 期调试用）
//
// 不暴露：
// - invalidateByConversation（trace 是审计层，不参与 C5 cascade 失效）
// - update / delete（step 一旦写入不可修改）
// ============================================================

import type { ITraceStepRepository } from "@/repositories/interfaces/ITraceStepRepository";
import type {
  AgentTraceStep,
  CreateTraceStepInput,
} from "@/types/agent.types";

export interface RecordStepInput {
  turn_id: string;
  conversation_id: string;
  message_id?: string;
  step_type: string;
  step_order: number;
  input_snapshot?: Record<string, unknown>;
  output_snapshot?: Record<string, unknown>;
  latency_ms?: number;
  error?: string;
}

export class ContextTraceService {
  constructor(private readonly repo: ITraceStepRepository) {}

  async recordStep(input: RecordStepInput): Promise<AgentTraceStep> {
    const data: CreateTraceStepInput = {
      id: crypto.randomUUID(),
      turn_id: input.turn_id,
      conversation_id: input.conversation_id,
      message_id: input.message_id,
      step_type: input.step_type,
      step_order: input.step_order,
      input_snapshot_json: input.input_snapshot
        ? JSON.stringify(input.input_snapshot)
        : undefined,
      output_snapshot_json: input.output_snapshot
        ? JSON.stringify(input.output_snapshot)
        : undefined,
      latency_ms: input.latency_ms,
      error: input.error,
    };
    return this.repo.create(data);
  }

  async recordSteps(inputs: RecordStepInput[]): Promise<AgentTraceStep[]> {
    const items: CreateTraceStepInput[] = inputs.map((input) => ({
      id: crypto.randomUUID(),
      turn_id: input.turn_id,
      conversation_id: input.conversation_id,
      message_id: input.message_id,
      step_type: input.step_type,
      step_order: input.step_order,
      input_snapshot_json: input.input_snapshot
        ? JSON.stringify(input.input_snapshot)
        : undefined,
      output_snapshot_json: input.output_snapshot
        ? JSON.stringify(input.output_snapshot)
        : undefined,
      latency_ms: input.latency_ms,
      error: input.error,
    }));
    return this.repo.createBatch(items);
  }

  /** 返回该 turn 内全部 step，按 step_order ASC */
  async findByTurn(turnId: string): Promise<AgentTraceStep[]> {
    return this.repo.findByTurn(turnId);
  }

  /** 返回与该 message 关联的 step */
  async findByMessage(messageId: string): Promise<AgentTraceStep[]> {
    return this.repo.findByMessage(messageId);
  }

  /** 按 conversation 查询（支持 limit / stepType / since，按 created_at DESC） */
  async findByConversation(
    conversationId: string,
    opts?: { limit?: number; stepType?: string; since?: string },
  ): Promise<AgentTraceStep[]> {
    return this.repo.findByConversation(conversationId, opts);
  }

  /** 取最近 n 条 step（debug 面板用） */
  async findLatestByConversation(
    conversationId: string,
    n: number,
  ): Promise<AgentTraceStep[]> {
    return this.repo.findLatestByConversation(conversationId, n);
  }

  /** 统计指定 step_type 在该 conversation 中的出现次数 */
  async countByStepType(conversationId: string, stepType: string): Promise<number> {
    return this.repo.countByStepType(conversationId, stepType);
  }
}
