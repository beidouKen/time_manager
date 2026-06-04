import { getDb } from "@/db/client";
import type { ITraceStepRepository } from "@/repositories/interfaces/ITraceStepRepository";
import type { AgentTraceStep, CreateTraceStepInput } from "@/types/agent.types";

function rowToStep(row: Record<string, unknown>): AgentTraceStep {
  return {
    id: row.id as string,
    turn_id: row.turn_id as string,
    conversation_id: row.conversation_id as string,
    message_id: (row.message_id as string | null) ?? undefined,
    step_type: row.step_type as string,
    step_order: row.step_order as number,
    input_snapshot_json: (row.input_snapshot_json as string | null) ?? undefined,
    output_snapshot_json: (row.output_snapshot_json as string | null) ?? undefined,
    latency_ms: (row.latency_ms as number | null) ?? undefined,
    error: (row.error as string | null) ?? undefined,
    created_at: row.created_at as string,
  };
}

export class SqliteTraceStepRepository implements ITraceStepRepository {
  async create(data: CreateTraceStepInput): Promise<AgentTraceStep> {
    const db = await getDb();
    const id = data.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO agent_trace_steps
         (id, turn_id, conversation_id, message_id, step_type, step_order,
          input_snapshot_json, output_snapshot_json, latency_ms, error, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        data.turn_id,
        data.conversation_id,
        data.message_id ?? null,
        data.step_type,
        data.step_order,
        data.input_snapshot_json ?? null,
        data.output_snapshot_json ?? null,
        data.latency_ms ?? null,
        data.error ?? null,
        now,
      ],
    );

    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM agent_trace_steps WHERE id = $1`,
      [id],
    );
    return rowToStep(rows[0]);
  }

  async createBatch(items: CreateTraceStepInput[]): Promise<AgentTraceStep[]> {
    return Promise.all(items.map((item) => this.create(item)));
  }

  async findByTurn(turnId: string): Promise<AgentTraceStep[]> {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM agent_trace_steps WHERE turn_id = $1 ORDER BY step_order ASC, created_at ASC`,
      [turnId],
    );
    return rows.map(rowToStep);
  }

  async findByMessage(messageId: string): Promise<AgentTraceStep[]> {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM agent_trace_steps WHERE message_id = $1 ORDER BY step_order ASC`,
      [messageId],
    );
    return rows.map(rowToStep);
  }

  async findByConversation(
    conversationId: string,
    opts?: { limit?: number; stepType?: string; since?: string },
  ): Promise<AgentTraceStep[]> {
    const db = await getDb();
    const conditions: string[] = ["conversation_id = $1"];
    const params: unknown[] = [conversationId];
    let paramIdx = 2;

    if (opts?.stepType) {
      conditions.push(`step_type = $${paramIdx++}`);
      params.push(opts.stepType);
    }
    if (opts?.since) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(opts.since);
    }

    const where = conditions.join(" AND ");
    const limit = opts?.limit ? `LIMIT $${paramIdx++}` : "";
    if (opts?.limit) params.push(opts.limit);

    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM agent_trace_steps WHERE ${where} ORDER BY created_at DESC ${limit}`,
      params,
    );
    return rows.map(rowToStep);
  }

  async findLatestByConversation(
    conversationId: string,
    n: number,
  ): Promise<AgentTraceStep[]> {
    return this.findByConversation(conversationId, { limit: n });
  }

  async countByStepType(
    conversationId: string,
    stepType: string,
  ): Promise<number> {
    const db = await getDb();
    const rows = await db.select<{ cnt: number }[]>(
      `SELECT COUNT(*) as cnt FROM agent_trace_steps
       WHERE conversation_id = $1 AND step_type = $2`,
      [conversationId, stepType],
    );
    return rows[0]?.cnt ?? 0;
  }
}
