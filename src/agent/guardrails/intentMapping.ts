import type { Intent } from "@/agent/schemas";
import type { SemanticUserGoal } from "@/agent/types";

const USER_GOAL_TO_INTENT: Partial<Record<SemanticUserGoal, Intent>> = {
  ask_current_time: "query_current_focus",
  create_and_schedule_task: "action_create_and_schedule",
  create_reminder: "action_create_task",
  delete_task: "action_delete_task",
  query_schedule: "query_today_schedule",
  general_chat: "low_signal",
  unsupported_intent: "low_signal",
  query_schedule_range: "query_scheduled_tasks",
  batch_delete_tasks: "action_delete_task",
  batch_reschedule_day: "action_reschedule",
  defer_task: "action_defer_task",
  update_recent_duration: "action_reschedule",
  query_tasks: "query_unscheduled_tasks",
  request_advice: "query_current_focus",
  mark_task_completed: "action_mark_completed",
  query_today_schedule: "query_today_schedule",
  recent_action_query: "query_recent_action",
};

export function mapUserGoalToIntent(
  userGoal: string | undefined
): Intent | undefined {
  if (!userGoal) return undefined;
  return USER_GOAL_TO_INTENT[userGoal as SemanticUserGoal];
}
