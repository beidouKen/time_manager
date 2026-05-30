import { useState, useRef, type KeyboardEvent } from "react";
import { Building2, Code2, MessageSquare, Send } from "lucide-react";
import { useChatStore, type ChatMode } from "@/store/chatStore";
import { cn } from "@/lib/utils";

const MODES: Array<{
  value: ChatMode;
  label: string;
  icon: typeof MessageSquare;
  placeholder: string;
}> = [
  {
    value: "agent",
    label: "对话",
    icon: MessageSquare,
    placeholder: "输入指令，例如：帮我安排两小时写报告...",
  },
  {
    value: "parse_link",
    label: "网页上下文",
    icon: Code2,
    placeholder: "输入页面链接，生成结构化上下文...",
  },
  {
    value: "wecom_context",
    label: "企业微信",
    icon: Building2,
    placeholder: "输入：样例 / 检查 / 调用 <category> <method> {\"limit\":10}",
  },
];

export function ChatInput() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("agent");
  const { sendMessage, isProcessing } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await sendMessage(trimmed, mode);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }
  };

  return (
    <div className="border-t border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-1 rounded-lg bg-gray-100 p-1">
        {MODES.map((item) => {
          const Icon = item.icon;
          const active = mode === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setMode(item.value)}
              disabled={isProcessing}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              <Icon size={13} />
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={MODES.find((item) => item.value === mode)?.placeholder}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          disabled={isProcessing}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || isProcessing}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>
    </div>
  );
}
