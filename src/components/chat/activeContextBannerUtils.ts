import type { PendingProposalSnapshot } from "@/agent/types";
import type { ActiveContext } from "@/types/agent.types";

interface ActiveContextBannerOptions {
  activeContext?: ActiveContext | null;
  activeTaskTitle?: string | null;
  pendingConfirmation?: {
    confirmationId?: string;
    toolName?: string;
    intent?: string;
  } | null;
}

export function formatTimeRange(
  startIso: string,
  endIso: string,
  timezone = "Asia/Shanghai"
): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("zh-CN", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${fmt(startIso)} - ${fmt(endIso)}`;
}

export function buildActiveContextBannerText(
  pendingProposal: PendingProposalSnapshot | null,
  timezone = "Asia/Shanghai",
  options: ActiveContextBannerOptions = {}
): string | null {
  const parts: string[] = [];

  if (pendingProposal?.kind === "recommendation") {
    const range = formatTimeRange(
      pendingProposal.start,
      pendingProposal.end,
      timezone
    );
    parts.push(`正在调整：${pendingProposal.title}｜${range}`);
  } else if (pendingProposal) {
    parts.push("待确认：1 个安排");
  }

  const activeContext = options.activeContext;
  if (activeContext?.active_task_id) {
    // C4: Show task title if available, fallback to shortened ID
    const displayName =
      options.activeTaskTitle ??
      activeContext.active_task_id.slice(0, 8) + "…";
    parts.push(`关注任务：${displayName}`);
  }
  if (activeContext?.active_time_block_id) {
    parts.push(`关注时间块：${activeContext.active_time_block_id}`);
  }

  const pendingConfirmation = options.pendingConfirmation;
  if (pendingConfirmation?.confirmationId) {
    parts.push(`待确认：${pendingConfirmation.toolName ?? pendingConfirmation.intent ?? "操作"}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}
