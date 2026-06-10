import { formatTimeInZone } from "@/agent/experience/dateFormatting";
import type { RendererInput, RendererOutput } from "./types";
import type { ResponseKind } from "@/agent/schemas";
import type { TimeBlock } from "@/types/timeblock.types";

export function formatTitle(value: unknown, fallback = "该任务"): string {
  const title = String(value ?? "").trim();
  return title || fallback;
}

export function formatTimeRange(
  block: Pick<TimeBlock, "start_time" | "end_time">,
  timezone: string
): string {
  return `${formatTimeInZone(block.start_time, timezone)} - ${formatTimeInZone(
    block.end_time,
    timezone
  )}`;
}

export function formatUnscheduledList(
  tasks: Array<{ title: string }>
): string {
  return tasks.map((task, index) => `${index + 1}. ${task.title}`).join("\n");
}

export function formatRecentActionList(
  actions: Array<{ summary: string }>
): string {
  return actions
    .map((action, index) => `${index + 1}. ${action.summary}`)
    .join("\n");
}

export function output(
  input: RendererInput,
  responseKind: ResponseKind,
  message: string,
  options?: {
    responseBranch?: string;
    genericFallbackUsed?: boolean;
  }
): RendererOutput {
  return {
    message,
    responseKind,
    responseBranch:
      options?.responseBranch ?? input.branchLabel ?? responseKind,
    genericFallbackUsed: options?.genericFallbackUsed ?? false,
  };
}

export function explicitMessage(input: RendererInput): string | undefined {
  const message = input.explicitMessage?.trim();
  return message ? message : undefined;
}

export function isValidIso(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  return !Number.isNaN(new Date(value).getTime());
}
