import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/store/chatStore";
import { useChatStore } from "@/store/chatStore";

interface Props {
  message: ChatMessageType;
}

export function ChatMessage({ message }: Props) {
  const { confirmAction, rejectAction, isProcessing } = useChatStore();
  const isUser = message.role === "user";

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
          isUser
            ? "bg-blue-600 text-white rounded-br-sm"
            : "bg-gray-100 text-gray-800 rounded-bl-sm"
        )}
      >
        {message.content}

        {message.confirmationId && message.role === "assistant" && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-gray-200">
            <button
              onClick={() => confirmAction(message.confirmationId!)}
              disabled={isProcessing}
              className="px-3 py-1 text-xs font-medium bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
            >
              确认执行
            </button>
            <button
              onClick={() => rejectAction(message.confirmationId!)}
              disabled={isProcessing}
              className="px-3 py-1 text-xs font-medium bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
            >
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
