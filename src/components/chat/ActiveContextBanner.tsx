import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "@/store/chatStore";
import { useTaskStore } from "@/store/taskStore";
import { buildActiveContextBannerText } from "@/components/chat/activeContextBannerUtils";

export function ActiveContextBanner() {
  const pendingProposal = useChatStore((s) => s.pendingProposal);
  const activeContext = useChatStore((s) => s.activeContext);
  // C4: Look up task title from taskStore instead of showing raw UUID
  const activeTaskTitle = useTaskStore((s) => {
    const taskId = activeContext?.active_task_id;
    if (!taskId) return null;
    return s.tasks.find((t) => t.id === taskId)?.title ?? null;
  });
  // useShallow 使用浅比较，避免每次 selector 返回新对象引用导致无限重渲染
  const pendingConfirmation = useChatStore(
    useShallow((s) => {
      const pending = [...s.messages].reverse().find((message) => {
        if (message.role !== "assistant") return false;
        const confirmationId = message.metadata?.confirmationId ?? message.confirmationId;
        if (!confirmationId) return false;
        const resultType = message.metadata?.resultType;
        return resultType === undefined || resultType === "pending_confirmation";
      });
      if (!pending) return null;
      return {
        confirmationId: pending.metadata?.confirmationId ?? pending.confirmationId,
        toolName: pending.metadata?.toolName,
        intent: pending.metadata?.intent,
      };
    })
  );
  const text = buildActiveContextBannerText(pendingProposal, "Asia/Shanghai", {
    activeContext,
    activeTaskTitle,
    pendingConfirmation,
  });

  if (!text) return null;

  return (
    <div className="mx-4 mt-3 mb-1 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs">
      {text}
    </div>
  );
}
