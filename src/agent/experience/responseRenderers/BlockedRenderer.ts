import { ResponseKinds } from "@/agent/schemas";
import type { ResponseRenderer, RendererInput, RendererOutput } from "./types";
import { output } from "./rendererShared";

const GUARDRAIL_REASONS: Record<string, string> = {
  PastTimeGuardrail: "你指定的时间已经过去，我不能直接创建未来安排",
  ConfirmationGuardrail: "这个操作影响较大，需要先得到你的明确确认",
  ResponseFallbackGuardrail: "当前回复没有满足请求所需的信息",
  InputIntentGuardrail: "查询请求不能触发写入操作",
  PlanSchemaGuardrail: "执行计划缺少必要信息",
  ToolPermissionGuardrail: "当前能力没有执行该操作的权限",
  ReadWriteBoundaryGuardrail: "只读请求不能修改你的数据",
};

export class BlockedRenderer implements ResponseRenderer {
  readonly kind = ResponseKinds.BLOCKED;

  render(input: RendererInput): RendererOutput {
    const blocked = input.blocked;
    const reason =
      blocked?.reason?.trim() ||
      GUARDRAIL_REASONS[blocked?.guardrailName ?? ""] ||
      "当前请求未通过安全检查";
    const nextStep =
      blocked?.nextStep?.trim() || "补充具体对象或调整请求后再试";
    return output(
      input,
      this.kind,
      `我暂时无法继续：${reason}。你可以${nextStep}。`,
      { responseBranch: input.branchLabel ?? "blocked" }
    );
  }
}
