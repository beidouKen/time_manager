import { ResponseKinds } from "@/agent/schemas";
import type { ResponseRenderer, RendererInput, RendererOutput } from "./types";
import { explicitMessage, formatTitle, output } from "./rendererShared";

export class ConfirmationRenderer implements ResponseRenderer {
  readonly kind = ResponseKinds.CONFIRMATION;

  render(input: RendererInput): RendererOutput {
    const explicit = explicitMessage(input);
    if (explicit) return output(input, this.kind, explicit);

    switch (input.branchLabel) {
      case "confirmation_missing":
        return output(input, this.kind, "这条确认请求已经不存在或过期了。");
      case "confirmation_stale":
        return output(input, this.kind, "这条确认请求已经处理过了。");
      case "confirmation_rejected":
        return output(input, this.kind, "已取消这次操作。");
      default: {
        const title = formatTitle(input.plan.params.title);
        const count = Number(
          input.plan.params.affectedCount ??
            input.plan.params.count ??
            (Array.isArray(input.plan.params.actions)
              ? input.plan.params.actions.length
              : 1)
        );
        const scope = Number.isFinite(count) && count > 1
          ? `，将影响 ${count} 项`
          : "";
        return output(
          input,
          this.kind,
          `确认要删除「${title}」吗${scope}？这个操作无法撤销。请回复“确认”继续。`
        );
      }
    }
  }
}
