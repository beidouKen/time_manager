import { useEffect, useRef } from "react";
import { useChatStore } from "@/store/chatStore";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageSquare } from "lucide-react";

export function ChatPanel() {
  const { messages, loadHistory } = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white">
        <MessageSquare size={18} className="text-blue-600" />
        <h2 className="text-sm font-semibold text-gray-800">助手</h2>
        <span className="text-xs text-gray-400">规则化解析 · External Context 测试</span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <MessageSquare size={40} className="mb-3 opacity-50" />
            <p className="text-sm">发送消息开始对话</p>
            <p className="text-xs mt-1">试试："我今天还有什么安排？"</p>
          </div>
        ) : (
          messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
        )}
      </div>

      {/* Input */}
      <ChatInput />
    </div>
  );
}
