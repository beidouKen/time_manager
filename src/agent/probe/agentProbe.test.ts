import { describe, expect, it } from "vitest";
import { AgentService } from "@/agent/AgentService";
import type {
  LLMChatOptions,
  LLMChatResponse,
  LLMClient,
  LLMMessage,
} from "@/agent/llm/LLMClient";
import { LLMError } from "@/agent/llm/LLMClient";
import { SqliteRagAdapter } from "@/agent/memory/SqliteRagAdapter";
import type { RagAdapter, RagSnippet } from "@/agent/memory/RagAdapter";
import { MockRagAdapter } from "@/agent/memory/MockRagAdapter";
import { MockMemoryAdapter } from "@/agent/memory/MockMemoryAdapter";
import { ConfirmationService } from "@/services/ConfirmationService";
import { RagService } from "@/services/rag/RagService";
import { buildFakeDb } from "@/services/rag/__tests__/_fakeRagDb";
import {
  MemoryActionLogPort,
  MemoryConfirmationRepository,
  MemoryScheduleService,
  MemoryTaskService,
  MemoryTimeBlockService,
} from "@/agent/testing/memoryServices";

interface ProbeArgs {
  chain?: string;
  llm?: "mock" | "real";
  rag?: "mock" | "sqlite";
  seed?: "probe" | "none";
  input?: string;
  assert?: string[];
  json?: boolean;
  inspectRag?: boolean | string;
}

interface ProbeReport {
  passed: boolean;
  failures: string[];
  chain: string;
  llm: string;
  rag: string;
  input: string;
  llmCalled: boolean;
  llmCallCount: number;
  ragCalled: boolean;
  ragCallCount: number;
  ragHitCount: number;
  ragQuery?: string;
  ragSnippetSources: string[];
  ragSnippetVisibleInFinalMessage: boolean;
  finalMessage: string;
  confirmationId?: string;
  planner?: string;
  actionPlanKind?: string;
  toolName?: string;
  model?: string;
  /** V3.8+: planner-only LLM 调用次数（不含 classifier）。 */
  plannerLLMCallCount: number;
  /** V3.8+: 在第一次 planner LLM 调用前，RAG 已被调用过的次数。 */
  ragQueriesBeforePlannerLLM: number;
  /** V3.8+: 第一次 planner LLM 调用的 messages 是否包含 RAG marker。 */
  llmPromptIncludesRagMarker: boolean;
  /** V3.8+: AgentTrace.ragContextInjected 透出值，便于 dev 观测。 */
  traceRagContextInjected?: boolean;
  traceRagSnippetCount?: number;
  traceRagQuery?: string;
  ragWorkflow?: Array<{
    phase: "before-planner-llm" | "after-response" | "unknown";
    query: string;
    hitCount: number;
    snippetPreviews: Array<{
      source: string;
      relevance: number;
      contentPreview: string;
    }>;
  }>;
  plannerRagBlockPreview?: string;
  plannerMessagesSummary?: Array<{
    role: string;
    chars: number;
    includesRagMarker: boolean;
    preview?: string;
  }>;
  error?: string;
}

const PROBE_MARKER = "PROBE_RAG_MARKER";
const DEFAULT_INPUT = "今天有哪些任务？请结合番茄工作法给我一个时间管理建议";
const DEFAULT_ASSERTS = ["llm-called", "rag-called", "rag-hit", "rag-visible"];

function readArgs(): ProbeArgs {
  const raw = import.meta.env.VITE_AGENT_PROBE_ARGS as string | undefined;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ProbeArgs;
  } catch {
    return {};
  }
}

function optionEnabled(value: boolean | string | undefined): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function preview(text: string | undefined, max = 260): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

interface RagCallObserver {
  getCallCount(): number;
}

class ProbeMockLLMClient implements LLMClient {
  readonly calls: LLMMessage[][] = [];
  /** V3.8+: 仅 planner（非 classifier）的调用序列。 */
  readonly plannerCalls: LLMMessage[][] = [];
  /** V3.8+: 第一次 planner 调用前 RAG 已发起的检索次数。 */
  ragQueriesBeforeFirstPlannerCall = 0;

  private ragObserver: RagCallObserver | undefined;

  /** V3.8+: 允许 probe 在构造 agent 之前把 RAG observer 绑定上来。 */
  attachRagObserver(observer: RagCallObserver): void {
    this.ragObserver = observer;
  }

  isAvailable(): boolean {
    return true;
  }

  getModelName(): string {
    return "probe-mock-llm";
  }

  async chat(
    messages: LLMMessage[],
    _options?: LLMChatOptions,
  ): Promise<LLMChatResponse> {
    this.calls.push(messages);
    const system = messages.find((m) => m.role === "system")?.content ?? "";

    if (system.includes("对话意图分类器")) {
      return {
        content: JSON.stringify({
          domain: "time_management",
          subtype: "query_schedule",
          confidence: 0.96,
          requiresWrite: false,
          reason: "用户在查询今天任务并请求时间管理建议",
        }),
      };
    }

    if (this.plannerCalls.length === 0 && this.ragObserver) {
      this.ragQueriesBeforeFirstPlannerCall = this.ragObserver.getCallCount();
    }
    this.plannerCalls.push(messages);

    return {
      content: JSON.stringify({
        kind: "tool",
        userGoal: "query_schedule",
        toolName: "get_today_plan",
        params: { date: "2026-06-05" },
        requiresConfirmation: false,
        riskLevel: "safe",
        summary: "查询今天任务并给出建议",
        clarifyingQuestion: null,
        confidence: 0.92,
      }),
    };
  }
}

class ProbeRealLLMClient implements LLMClient {
  readonly calls: LLMMessage[][] = [];
  readonly plannerCalls: LLMMessage[][] = [];
  ragQueriesBeforeFirstPlannerCall = 0;
  private ragObserver: RagCallObserver | undefined;

  private readonly baseURL: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor() {
    this.baseURL =
      (import.meta.env.VITE_DEEPSEEK_BASE_URL as string | undefined) ||
      "https://api.deepseek.com";
    this.model =
      (import.meta.env.VITE_DEEPSEEK_MODEL as string | undefined) ||
      "deepseek-chat";
    this.apiKey =
      (import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined) || "";
  }

  attachRagObserver(observer: RagCallObserver): void {
    this.ragObserver = observer;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey.trim());
  }

  getModelName(): string {
    return this.model;
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMChatOptions,
  ): Promise<LLMChatResponse> {
    this.calls.push(messages);
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const isClassifier = system.includes("对话意图分类器");
    if (!isClassifier) {
      if (this.plannerCalls.length === 0 && this.ragObserver) {
        this.ragQueriesBeforeFirstPlannerCall = this.ragObserver.getCallCount();
      }
      this.plannerCalls.push(messages);
    }
    if (!this.isAvailable()) {
      throw new LLMError("api_key_missing", "VITE_DEEPSEEK_API_KEY is missing");
    }

    const url = `${this.baseURL.replace(/\/+$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), 45_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options?.temperature ?? 0.1,
          max_tokens: options?.maxTokens ?? 1024,
          response_format: { type: "json_object" },
        }),
      });
    } finally {
      globalThis.clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new LLMError(
        "http_error",
        `LLM HTTP ${response.status}`,
        response.status,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LLMError("parse_error", "LLM response missing content");
    }

    return {
      content,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }
}

class ObservedRagAdapter implements RagAdapter {
  readonly queries: string[] = [];
  readonly snippets: RagSnippet[][] = [];

  constructor(private readonly inner: RagAdapter) {}

  async retrieveRelatedHistory(query: string): Promise<{ snippets: RagSnippet[] }> {
    this.queries.push(query);
    const result = await this.inner.retrieveRelatedHistory(query);
    this.snippets.push(result.snippets);
    return result;
  }
}

async function createRagAdapter(kind: string, seed: string): Promise<ObservedRagAdapter> {
  const snippet: RagSnippet = {
    content:
      `${PROBE_MARKER} 番茄工作法时间管理建议：今天任务较多时，` +
      "优先使用 25 分钟专注加 5 分钟休息的节奏，并把任务拆成可完成的小块。",
    relevance: 0.99,
    source: "probe:seed",
  };

  if (kind === "mock") {
    return new ObservedRagAdapter(new MockRagAdapter(seed === "none" ? [] : [snippet]));
  }

  const db = buildFakeDb();
  const service = new RagService(db);
  if (seed !== "none") {
    await service.ingestDocument({
      sourceType: "seed_knowledge",
      title: "Probe seed: 番茄工作法",
      tags: ["probe", "time_management", "pomodoro"],
      status: "active",
      trustLevel: "high",
      chunks: [{ content: snippet.content, tags: ["probe", "pomodoro"] }],
    });
  }

  return new ObservedRagAdapter(
    new SqliteRagAdapter({
      service,
      defaultSourceTypes: ["seed_knowledge"],
      defaultLimit: 2,
    }),
  );
}

async function runProbe(): Promise<ProbeReport> {
  const args = readArgs();
  const chain = args.chain ?? "llm-rag";
  const llmKind = args.llm ?? "mock";
  const ragKind = args.rag ?? "sqlite";
  const input = args.input ?? DEFAULT_INPUT;

  if (chain !== "llm-rag") {
    throw new Error(`Unsupported probe chain: ${chain}`);
  }

  const llm =
    llmKind === "real" ? new ProbeRealLLMClient() : new ProbeMockLLMClient();
  const rag = await createRagAdapter(ragKind, args.seed ?? "probe");

  // V3.8+: 让 LLM 客户端能在 planner 调用前快照 RAG 检索次数
  llm.attachRagObserver({ getCallCount: () => rag.queries.length });

  const tasks = new MemoryTaskService();
  const blocks = new MemoryTimeBlockService();
  const schedule = new MemoryScheduleService(tasks, blocks);
  const confirmRepo = new MemoryConfirmationRepository();
  const confirmService = new ConfirmationService(confirmRepo);

  const agent = new AgentService({
    taskService: tasks,
    timeBlockService: blocks,
    scheduleService: schedule,
    logService: new MemoryActionLogPort(),
    confirmService,
    llmClient: llm,
    ragAdapter: rag,
    memoryAdapter: new MockMemoryAdapter(),
  });

  const response = await agent.processInput(input, {
    timezone: "Asia/Shanghai",
    currentTimelineDate: "2026-06-05",
    selectedDate: "2026-06-05",
  });

  const trace = response.metadata?.agentTrace;
  const allSnippets = rag.snippets.flat();
  const finalMessage = response.message ?? "";
  const plannerCalls = llm.plannerCalls;
  const firstPlannerMessages = plannerCalls[0] ?? [];
  const llmPromptIncludesRagMarker = firstPlannerMessages.some((m) =>
    m.content.includes(PROBE_MARKER),
  );
  const inspectRag = optionEnabled(args.inspectRag);
  const plannerRagMessage = firstPlannerMessages.find((m) =>
    m.content.includes(PROBE_MARKER) ||
    m.content.includes("以下是本地知识库检索到的参考资料"),
  );
  const ragWorkflow = inspectRag
    ? rag.queries.map((query, index) => {
        const snippets = rag.snippets[index] ?? [];
        const phase: "before-planner-llm" | "after-response" | "unknown" =
          index < llm.ragQueriesBeforeFirstPlannerCall
            ? "before-planner-llm"
            : index === llm.ragQueriesBeforeFirstPlannerCall
              ? "after-response"
              : "unknown";
        return {
          phase,
          query,
          hitCount: snippets.length,
          snippetPreviews: snippets.map((snippet) => ({
            source: snippet.source ?? "unknown",
            relevance: snippet.relevance,
            contentPreview: preview(snippet.content),
          })),
        };
      })
    : undefined;
  const report: ProbeReport = {
    passed: false,
    failures: [],
    chain,
    llm: llmKind,
    rag: ragKind,
    input,
    llmCalled: llm.calls.length > 0,
    llmCallCount: llm.calls.length,
    ragCalled: rag.queries.length > 0,
    ragCallCount: rag.queries.length,
    ragHitCount: allSnippets.length,
    ragQuery: rag.queries[0],
    ragSnippetSources: allSnippets.map((s) => s.source ?? "unknown"),
    ragSnippetVisibleInFinalMessage: finalMessage.includes(PROBE_MARKER),
    finalMessage,
    confirmationId: response.confirmationId,
    planner: trace?.planner,
    actionPlanKind: trace?.actionPlan?.kind,
    toolName: trace?.actionPlan?.toolName,
    model: llm.getModelName(),
    plannerLLMCallCount: plannerCalls.length,
    ragQueriesBeforePlannerLLM: llm.ragQueriesBeforeFirstPlannerCall,
    llmPromptIncludesRagMarker,
    traceRagContextInjected: trace?.ragContextInjected,
    traceRagSnippetCount: trace?.ragSnippetCount,
    traceRagQuery: trace?.ragQuery,
    ragWorkflow,
    plannerRagBlockPreview: inspectRag ? preview(plannerRagMessage?.content, 700) : undefined,
    plannerMessagesSummary: inspectRag
      ? firstPlannerMessages.map((message) => ({
          role: message.role,
          chars: message.content.length,
          includesRagMarker: message.content.includes(PROBE_MARKER),
          preview:
            message.content.includes(PROBE_MARKER) ||
            message.content.includes("以下是本地知识库检索到的参考资料")
              ? preview(message.content, 400)
              : undefined,
        }))
      : undefined,
  };

  const requestedAsserts = args.assert?.length ? args.assert : DEFAULT_ASSERTS;
  const checks: Record<string, boolean> = {
    "llm-called": report.llmCalled,
    "rag-called": report.ragCalled,
    "rag-hit": report.ragHitCount > 0,
    "rag-visible": report.ragSnippetVisibleInFinalMessage,
    "planner-llm": report.planner === "llm",
    "no-confirmation": !report.confirmationId,
    // V3.8+: RAG 必须在 planner LLM 调用前发起检索
    "rag-before-llm":
      report.plannerLLMCallCount > 0 && report.ragQueriesBeforePlannerLLM > 0,
    // V3.8+: planner 的第一次 LLM 调用 messages 必须包含 RAG marker
    "llm-prompt-has-rag": report.llmPromptIncludesRagMarker,
  };

  report.failures = requestedAsserts.filter((name) => checks[name] !== true);
  report.passed = report.failures.length === 0;
  return report;
}

describe("agent:probe llm-rag", () => {
  it("runs the requested LLM/RAG probe chain", async () => {
    let report: ProbeReport;
    try {
      report = await runProbe();
    } catch (err) {
      report = {
        passed: false,
        failures: ["probe-error"],
        chain: "llm-rag",
        llm: "unknown",
        rag: "unknown",
        input: DEFAULT_INPUT,
        llmCalled: false,
        llmCallCount: 0,
        ragCalled: false,
        ragCallCount: 0,
        ragHitCount: 0,
        ragSnippetSources: [],
        ragSnippetVisibleInFinalMessage: false,
        finalMessage: "",
        plannerLLMCallCount: 0,
        ragQueriesBeforePlannerLLM: 0,
        llmPromptIncludesRagMarker: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    console.log(`__AGENT_PROBE_RESULT__${JSON.stringify(report)}`);
    expect(report.passed, report.failures.join(", ") || report.error).toBe(true);
  }, 60_000);
});
