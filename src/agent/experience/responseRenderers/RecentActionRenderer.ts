import { ResponseKinds } from "@/agent/schemas";
import type { ResponseRenderer, RendererInput, RendererOutput } from "./types";
import {
  explicitMessage,
  formatRecentActionList,
  output,
} from "./rendererShared";

export class RecentActionRenderer implements ResponseRenderer {
  readonly kind = ResponseKinds.RECENT_ACTION;

  render(input: RendererInput): RendererOutput {
    const explicit = explicitMessage(input);
    if (explicit) return output(input, this.kind, explicit);

    const actions = input.recentActions ?? [];
    if (actions.length === 0) {
      return output(
        input,
        this.kind,
        "暂时没有最近动作记录。等你做点什么之后我再帮你回顾。"
      );
    }
    return output(
      input,
      this.kind,
      `刚才我做了：\n${formatRecentActionList(actions)}`
    );
  }
}
