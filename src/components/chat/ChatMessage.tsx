import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/store/chatStore";
import { useChatStore } from "@/store/chatStore";

interface Props {
  message: ChatMessageType;
}

const MODE_LABEL: Record<string, string> = {
  tool_plan: "工具执行",
  clarification: "追问",
  chitchat: "闲聊",
  unsupported: "不支持",
  error: "错误",
};

const ERROR_KIND_LABEL: Record<string, string> = {
  disabled: "Agent 未启用",
  api_key_missing: "API Key 缺失",
  network_error: "网络错误",
  http_error: "HTTP 错误",
  parse_error: "输出格式错误",
  fallback: "处理失败",
};

export function ChatMessage({ message }: Props) {
  const { confirmAction, rejectAction, isProcessing } = useChatStore();
  const isUser = message.role === "user";

  // confirmationId 优先从 metadata 读取，向后兼容旧的顶层字段
  const confirmationId =
    message.metadata?.confirmationId ?? message.confirmationId;

  // V3.5：优先读取 agentTrace，兼容旧字段
  const trace = message.metadata?.agentTrace;
  const isLLM = message.metadata?.source === "llm";
  const traceMode = trace?.mode;
  const isError = traceMode === "error";

  // 兼容旧字段（无 trace 时降级）
  const llmResponseType = trace
    ? (traceMode !== "error" ? traceMode : undefined)
    : message.metadata?.llmResponseType;
  const llmModel = trace?.model ?? message.metadata?.llmModel;

  // 气泡样式
  const bubbleStyle = (() => {
    if (isUser) return "bg-blue-600 text-white rounded-br-sm";
    if (isError) return "bg-red-50 text-red-800 border border-red-200 rounded-bl-sm";
    if (llmResponseType === "clarification") {
      return "bg-amber-50 text-gray-800 border border-amber-200 rounded-bl-sm";
    }
    if (llmResponseType === "unsupported") {
      return "bg-gray-50 text-gray-500 border border-gray-200 rounded-bl-sm";
    }
    return "bg-gray-100 text-gray-800 rounded-bl-sm";
  })();

  return (
    <div
      className={cn(
        "flex w-full mb-3",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap",
          bubbleStyle
        )}
      >
        {/* 错误前置图标 */}
        {isError && !isUser && (
          <span className="mr-1 text-red-500">⚠</span>
        )}

        {/* clarification 前置问号图标 */}
        {llmResponseType === "clarification" && (
          <span className="mr-1 text-amber-500">❓</span>
        )}

        {/* unsupported 前置图标 */}
        {llmResponseType === "unsupported" && (
          <span className="mr-1 text-gray-400">🚫</span>
        )}

        {message.content}

        {/* 危险操作确认按钮（保持不变） */}
        {confirmationId && message.role === "assistant" && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-gray-200">
            <button
              onClick={() => confirmAction(confirmationId)}
              disabled={isProcessing}
              className="px-3 py-1 text-xs font-medium bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
            >
              确认执行
            </button>
            <button
              onClick={() => rejectAction(confirmationId)}
              disabled={isProcessing}
              className="px-3 py-1 text-xs font-medium bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
            >
              取消
            </button>
          </div>
        )}

        {/* V3.5：AgentTrace 底部标签（仅 assistant 且有 LLM 来源时显示） */}
        {isLLM && !isUser && (
          <div className={cn(
            "mt-2 pt-1 border-t flex items-center gap-1.5",
            isError ? "border-red-200" : "border-gray-200"
          )}>
            {trace ? (
              <>
                <span className={cn(
                  "text-[10px] leading-none",
                  isError ? "text-red-400" : "text-gray-400"
                )}>
                  {isError
                    ? `✕ ${trace.errorKind ? ERROR_KIND_LABEL[trace.errorKind] ?? trace.errorKind : "错误"}`
                    : `✨ ${MODE_LABEL[traceMode ?? ""] ?? traceMode}`}
                </span>
                {llmModel && (
                  <span className="text-[10px] text-gray-300 leading-none">
                    · {llmModel}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[10px] text-gray-400 leading-none">
                ✨ {llmModel ?? "LLM"}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
