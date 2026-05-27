import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/store/chatStore";
import { useChatStore } from "@/store/chatStore";

interface Props {
  message: ChatMessageType;
}

export function ChatMessage({ message }: Props) {
  const { confirmAction, rejectAction, isProcessing } = useChatStore();
  const isUser = message.role === "user";

  // V2.5：confirmationId 优先从 metadata 读取，向后兼容旧的顶层字段
  const confirmationId =
    message.metadata?.confirmationId ?? message.confirmationId;

  // V3：LLM 相关 metadata
  const isLLM = message.metadata?.source === "llm";
  const llmResponseType = message.metadata?.llmResponseType;
  const llmModel = message.metadata?.llmModel;

  // 气泡样式：根据 LLM 响应类型微调颜色
  const bubbleStyle = (() => {
    if (isUser) return "bg-blue-600 text-white rounded-br-sm";
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
        {/* clarification 前置问号图标 */}
        {llmResponseType === "clarification" && (
          <span className="mr-1 text-amber-500">❓</span>
        )}

        {/* unsupported 前置图标 */}
        {llmResponseType === "unsupported" && (
          <span className="mr-1 text-gray-400">🚫</span>
        )}

        {message.content}

        {/* 危险操作确认按钮（V2.5 已有，不变） */}
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

        {/* V3：LLM 来源标记（底部小标签，仅 assistant 消息显示） */}
        {isLLM && !isUser && (
          <div className="mt-2 pt-1 border-t border-gray-200 flex items-center gap-1">
            <span className="text-[10px] text-gray-400 leading-none">
              ✨ {llmModel ?? "LLM"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
