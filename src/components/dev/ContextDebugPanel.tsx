// ============================================================
// ContextDebugPanel.tsx — C6 Dev-only Context Trace 调试面板
//
// 仅在 import.meta.env.DEV 模式下渲染。
// 生产构建中，第一行 guard 会被 vite define dead-code-eliminate 掉，
// 不会打包任何组件代码到生产 bundle。
//
// 守护清单（C6 §6.2）：
// 1. 文件路径在 src/components/dev/（路径名传达"仅 dev"语义）
// 2. 组件第一有效行：if (!import.meta.env.DEV) return null
// 3. 父组件（ChatPanel 抽屉触发器）也加同样守护
// ============================================================

import { useEffect, useState } from "react";
import type { AgentTraceStep } from "@/types/agent.types";
import type { ActiveContext } from "@/types/agent.types";
import type { SemanticEvent } from "@/types/agent.types";

// 数据源：直接调用 service（仅 dev；不直接读 DB）
// 注意：这些 service 在 dev 环境下通过 DI 注入，测试时可 mock
import { SqliteTraceStepRepository } from "@/repositories/sqlite/SqliteTraceStepRepository";
import { SqliteActiveContextRepository } from "@/repositories/sqlite/SqliteActiveContextRepository";
import { SqliteSemanticEventRepository } from "@/repositories/sqlite/SqliteSemanticEventRepository";
import { ContextTraceService } from "@/services/ContextTraceService";
import { ActiveContextService } from "@/services/ActiveContextService";
import { SemanticEventService } from "@/services/SemanticEventService";

// ─── 懒加载 service（仅 dev 环境初始化，避免生产 bundle 体积增加） ──────────

let _traceService: ContextTraceService | undefined;
let _activeContextService: ActiveContextService | undefined;
let _semanticEventService: SemanticEventService | undefined;

function getDevServices() {
  if (!_traceService) {
    _traceService = new ContextTraceService(new SqliteTraceStepRepository());
    _activeContextService = new ActiveContextService(new SqliteActiveContextRepository());
    _semanticEventService = new SemanticEventService(new SqliteSemanticEventRepository());
  }
  return {
    traceService: _traceService,
    activeContextService: _activeContextService!,
    semanticEventService: _semanticEventService!,
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ContextDebugPanelProps {
  turnId?: string;
  conversationId?: string;
  mode?: "turn" | "conversation";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StepRow({ step }: { step: AgentTraceStep }) {
  const [expanded, setExpanded] = useState(false);

  const inputObj: Record<string, unknown> | null = step.input_snapshot_json
    ? tryParseJson(step.input_snapshot_json) as Record<string, unknown>
    : null;
  const outputObj: Record<string, unknown> | null = step.output_snapshot_json
    ? tryParseJson(step.output_snapshot_json) as Record<string, unknown>
    : null;

  return (
    <div
      style={{
        borderBottom: "1px solid #e2e8f0",
        padding: "6px 8px",
        cursor: "pointer",
        fontSize: 12,
      }}
      onClick={() => setExpanded((x) => !x)}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span
          style={{
            background: stepTypeColor(step.step_type),
            color: "#fff",
            borderRadius: 3,
            padding: "1px 5px",
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          {step.step_type}
        </span>
        <span style={{ color: "#64748b" }}>#{step.step_order}</span>
        {step.latency_ms != null && (
          <span style={{ color: "#94a3b8" }}>{step.latency_ms}ms</span>
        )}
        {step.error && <span style={{ color: "#ef4444" }}>⚠ {step.error}</span>}
      </div>
      {expanded && (inputObj || outputObj) && (
        <div style={{ marginTop: 4, display: "flex", gap: 8 }}>
          {inputObj && (
            <pre
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 4,
                padding: "4px 6px",
                fontSize: 10,
                overflow: "auto",
                maxHeight: 120,
                flex: 1,
              }}
            >
              {JSON.stringify(inputObj, null, 2)}
            </pre>
          )}
          {outputObj && (
            <pre
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 4,
                padding: "4px 6px",
                fontSize: 10,
                overflow: "auto",
                maxHeight: 120,
                flex: 1,
              }}
            >
              {JSON.stringify(outputObj, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function tryParseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

function stepTypeColor(type: string): string {
  const colors: Record<string, string> = {
    context_resolve: "#7c3aed",
    context_assemble: "#6d28d9",
    route: "#2563eb",
    parse: "#0891b2",
    plan: "#059669",
    execute: "#d97706",
    confirm_create: "#db2777",
    confirm_resolve: "#16a34a",
    reject: "#dc2626",
    refine: "#ea580c",
  };
  return colors[type] ?? "#6b7280";
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ContextDebugPanel({
  turnId,
  conversationId,
  mode = "turn",
}: ContextDebugPanelProps) {
  // ⚠ DEV GUARD — this line must remain first
  if (!import.meta.env.DEV) return null;

  const [isOpen, setIsOpen] = useState(false);
  const [steps, setSteps] = useState<AgentTraceStep[]>([]);
  const [activeCtx, setActiveCtx] = useState<ActiveContext | null>(null);
  const [recentEvents, setRecentEvents] = useState<SemanticEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (!turnId && !conversationId) return;

    setLoading(true);
    const { traceService, activeContextService, semanticEventService } =
      getDevServices();

    Promise.all([
      turnId && mode === "turn"
        ? traceService.findByTurn(turnId)
        : conversationId
          ? traceService.findLatestByConversation(conversationId, 20)
          : Promise.resolve([]),
      conversationId
        ? activeContextService.findActiveByConversation(conversationId)
        : Promise.resolve(null),
      conversationId
        ? semanticEventService.findByConversation(conversationId, { limit: 10 })
        : Promise.resolve([]),
    ])
      .then(([s, ac, ev]) => {
        setSteps(s as AgentTraceStep[]);
        setActiveCtx(ac as ActiveContext | null);
        setRecentEvents(ev as SemanticEvent[]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isOpen, turnId, conversationId, mode]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        right: 16,
        width: 480,
        background: "#1e293b",
        color: "#e2e8f0",
        borderRadius: "8px 8px 0 0",
        boxShadow: "0 -4px 16px rgba(0,0,0,0.3)",
        zIndex: 9999,
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      {/* Header toggle */}
      <button
        onClick={() => setIsOpen((x) => !x)}
        style={{
          width: "100%",
          background: "#334155",
          border: "none",
          color: "#94a3b8",
          padding: "6px 12px",
          cursor: "pointer",
          borderRadius: "8px 8px 0 0",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontFamily: "monospace",
        }}
      >
        <span style={{ color: "#22d3ee" }}>⬡</span>
        <span style={{ fontWeight: 600 }}>ContextDebugPanel</span>
        <span style={{ color: "#64748b" }}>
          [DEV] {turnId ? `turn=${turnId.slice(0, 8)}…` : ""}
          {conversationId ? ` conv=${conversationId.slice(0, 8)}…` : ""}
        </span>
        <span style={{ marginLeft: "auto" }}>{isOpen ? "▼" : "▲"}</span>
      </button>

      {isOpen && (
        <div style={{ maxHeight: 400, overflow: "auto" }}>
          {loading && (
            <div style={{ padding: 12, color: "#94a3b8" }}>加载中…</div>
          )}

          {!loading && (
            <>
              {/* Step Timeline */}
              <section>
                <div
                  style={{
                    padding: "4px 8px",
                    background: "#0f172a",
                    color: "#94a3b8",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  TRACE STEPS ({steps.length})
                </div>
                {steps.length === 0 ? (
                  <div style={{ padding: 8, color: "#475569", fontSize: 11 }}>
                    暂无 step（本 turn 尚未完成或 ContextTraceService 未注入）
                  </div>
                ) : (
                  steps.map((s) => <StepRow key={s.id} step={s} />)
                )}
              </section>

              {/* Active Context */}
              <section>
                <div
                  style={{
                    padding: "4px 8px",
                    background: "#0f172a",
                    color: "#94a3b8",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  ACTIVE CONTEXT
                </div>
                {activeCtx ? (
                  <pre
                    style={{
                      padding: 8,
                      fontSize: 10,
                      color: "#a5f3fc",
                      overflow: "auto",
                      maxHeight: 100,
                    }}
                  >
                    {JSON.stringify(
                      {
                        status: activeCtx.status,
                        domain: activeCtx.active_domain,
                        intent: activeCtx.active_intent,
                        confirmationId: activeCtx.active_confirmation_id,
                        proposalId: activeCtx.active_proposal_id,
                      },
                      null,
                      2
                    )}
                  </pre>
                ) : (
                  <div style={{ padding: 8, color: "#475569", fontSize: 11 }}>
                    无 active context
                  </div>
                )}
              </section>

              {/* Recent Semantic Events */}
              <section>
                <div
                  style={{
                    padding: "4px 8px",
                    background: "#0f172a",
                    color: "#94a3b8",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  RECENT SEMANTIC EVENTS ({recentEvents.length})
                </div>
                {recentEvents.length === 0 ? (
                  <div style={{ padding: 8, color: "#475569", fontSize: 11 }}>
                    暂无事件
                  </div>
                ) : (
                  recentEvents.slice(0, 5).map((ev) => (
                    <div
                      key={ev.id}
                      style={{
                        borderBottom: "1px solid #1e293b",
                        padding: "4px 8px",
                        fontSize: 11,
                        color: "#cbd5e1",
                      }}
                    >
                      <span style={{ color: "#818cf8" }}>{ev.domain}</span>
                      {" · "}
                      <span style={{ color: "#34d399" }}>{ev.intent}</span>
                      {" · "}
                      <span style={{ color: "#64748b" }}>
                        {ev.context_role}
                      </span>
                    </div>
                  ))
                )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
