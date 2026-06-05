import { useChatStore } from "@/store/chatStore";
import { buildActiveContextBannerText } from "@/components/chat/activeContextBannerUtils";

export function ActiveContextBanner() {
  const pendingProposal = useChatStore((s) => s.pendingProposal);
  const activeContext = useChatStore((s) => s.activeContext);
  const pendingConfirmation = useChatStore((s) => {
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
  });
  const text = buildActiveContextBannerText(pendingProposal, "Asia/Shanghai", {
    activeContext,
    pendingConfirmation,
  });

  if (!text) return null;

  return (
    <div className="mx-4 mt-3 mb-1 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs">
      {text}
    </div>
  );
}
