import { ResponseKinds } from "@/agent/schemas";
import type { ResponseRenderer, RendererInput, RendererOutput } from "./types";
import { output } from "./rendererShared";

const KNOWN_ERROR_BRANCHES = new Set([
  "tool_failure",
  "verification_failed",
  "external_info_no_tool",
]);

export class ErrorRenderer implements ResponseRenderer {
  readonly kind = ResponseKinds.ERROR;

  render(input: RendererInput): RendererOutput {
    switch (input.branchLabel) {
      case "tool_failure":
        return output(
          input,
          this.kind,
          "我没能完成这个操作。你可以换一种说法，或稍后再试。"
        );
      case "verification_failed":
        return output(
          input,
          this.kind,
          "我执行后发现结果和你的要求不一致，所以没有把它当作成功处理。"
        );
      case "external_info_no_tool":
        return output(
          input,
          this.kind,
          "这个请求需要实时外部信息，但我当前无法直接联网查询。你可以提供数据，我来帮你分析和整理。"
        );
      default:
        return output(
          input,
          this.kind,
          "这次没有得到可靠结果。请稍后重试，或换一种更具体的说法。",
          {
            responseBranch: "error_fallback",
            genericFallbackUsed: !KNOWN_ERROR_BRANCHES.has(
              input.branchLabel ?? ""
            ),
          }
        );
    }
  }
}
