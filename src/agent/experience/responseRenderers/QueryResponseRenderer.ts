import { ResponseKinds } from "@/agent/schemas";
import type { ResponseRenderer, RendererInput, RendererOutput } from "./types";
import {
  explicitMessage,
  formatTimeRange,
  formatUnscheduledList,
  output,
} from "./rendererShared";

export class QueryResponseRenderer implements ResponseRenderer {
  readonly kind = ResponseKinds.QUERY_RESULT;

  render(input: RendererInput): RendererOutput {
    const explicit = explicitMessage(input);
    if (explicit) return output(input, this.kind, explicit);

    const goal = input.frame.userGoal;
    const tasks =
      input.queryTasks ??
      this.toTaskList(input.toolResults[0]?.data);

    if (goal === "query_schedule" || goal === "query_task_schedule_status") {
      if (!input.plan.params.taskId && goal === "query_schedule") {
        return output(
          input,
          this.kind,
          "我还不知道你指的是哪个任务。可以告诉我任务名称吗？"
        );
      }
      const block = input.queryBlocks?.[0];
      if (!block) {
        return output(input, this.kind, "我还没有找到这个任务的时间安排。");
      }
      return output(
        input,
        this.kind,
        `这个任务安排在 ${formatTimeRange(block, input.context.timezone)}。`
      );
    }

    if (goal === "query_completed_tasks") {
      if (tasks.length === 0) {
        return output(input, this.kind, "暂时没有完成的任务。");
      }
      return output(
        input,
        this.kind,
        `已完成的任务有：\n${formatUnscheduledList(tasks)}`
      );
    }

    if (
      goal === "query_today_schedule" ||
      goal === "query_tomorrow_schedule" ||
      goal === "query_schedule_range"
    ) {
      const blocks = input.queryBlocks ?? this.toBlockList(input.toolResults[0]?.data);
      if (blocks.length === 0) {
        const day = goal === "query_tomorrow_schedule" ? "明天" : "今天";
        return output(input, this.kind, `${day}还没有安排。`);
      }
      const list = blocks
        .map(
          (block, index) =>
            `${index + 1}. ${block.title ?? "未命名安排"} ${formatTimeRange(
              block,
              input.context.timezone
            )}`
        )
        .join("\n");
      return output(input, this.kind, `日程如下：\n${list}`);
    }

    if (goal === "query_current_focus") {
      const first = tasks[0];
      return output(
        input,
        this.kind,
        first ? `当前建议专注「${first.title}」。` : "当前没有正在进行的任务。"
      );
    }

    if (tasks.length === 0) {
      return output(input, this.kind, "目前没有未安排的任务。");
    }
    return output(
      input,
      this.kind,
      `还没安排的任务有：\n${formatUnscheduledList(tasks)}`
    );
  }

  private toTaskList(data: unknown): Array<{ title: string; status: string }> {
    if (!Array.isArray(data)) return [];
    return data.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const title = String(record.title ?? "").trim();
      return title
        ? [{ title, status: String(record.status ?? "unknown") }]
        : [];
    });
  }

  private toBlockList(data: unknown): NonNullable<RendererInput["queryBlocks"]> {
    if (!Array.isArray(data)) return [];
    return data.filter(
      (item): item is NonNullable<RendererInput["queryBlocks"]>[number] =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>).start_time === "string" &&
            typeof (item as Record<string, unknown>).end_time === "string"
        )
    );
  }
}
