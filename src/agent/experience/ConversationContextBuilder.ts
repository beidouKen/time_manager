import type {
  AgentExperienceContext,
  AgentToolResult,
} from "@/agent/types";
import type { RecentMessage } from "@/agent/llm/contextBuilder";

export interface ConversationContextInput {
  recentMessages?: RecentMessage[];
  timezone?: string;
  currentTimelineDate?: string;
  selectedDate?: string;
  currentScreen?: string;
}

export interface ConversationMemorySnapshot {
  lastCreatedTaskId: string | null;
  lastMentionedTaskIds: string[];
  lastScheduledTimeBlockIds: string[];
  lastToolResults: AgentToolResult[];
}

const RECENT_MESSAGES_LIMIT = 8;
const DEFAULT_TIMEZONE = "Asia/Shanghai";

export class ConversationContextBuilder {
  build(
    input: ConversationContextInput | undefined,
    memory: ConversationMemorySnapshot
  ): AgentExperienceContext {
    return {
      currentDatetime: new Date().toISOString(),
      timezone: input?.timezone || DEFAULT_TIMEZONE,
      currentTimelineDate: input?.currentTimelineDate,
      selectedDate: input?.selectedDate,
      currentScreen: input?.currentScreen,
      recentMessages: (input?.recentMessages ?? [])
        .slice(-RECENT_MESSAGES_LIMIT)
        .map((message) => ({
          role: message.role,
          content:
            message.content.length > 300
              ? `${message.content.slice(0, 300)}...`
              : message.content,
        })),
      lastCreatedTaskId: memory.lastCreatedTaskId,
      lastMentionedTaskIds: [...memory.lastMentionedTaskIds],
      lastScheduledTimeBlockIds: [...memory.lastScheduledTimeBlockIds],
      lastToolResults: [...memory.lastToolResults],
    };
  }
}
