import type { EventSubKind, SemanticType } from "@/agent/types";

export function getSemanticDisplayNoun(constraints?: {
  semanticType?: SemanticType;
  eventSubKind?: EventSubKind;
}): string {
  if (!constraints) return "任务";

  switch (constraints.semanticType) {
    case "activity":
      return "活动";
    case "routine_candidate":
      return "计划";
    case "event":
      switch (constraints.eventSubKind) {
        case "lesson":
          return "课程";
        case "meeting":
          return "会议";
        default:
          return "安排";
      }
    default:
      return "任务";
  }
}
