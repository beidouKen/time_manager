import { useState, useRef, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { useChatStore } from "@/store/chatStore";

export function ChatInput() {
  const [input, setInput] = useState("");
  const { sendMessage, isProcessing } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await sendMessage(trimmed);
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
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="输入指令，例如：帮我安排两小时写报告..."
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
