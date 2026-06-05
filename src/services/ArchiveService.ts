import { TaskService } from "@/services/TaskService";
import { ActionLogService } from "@/services/ActionLogService";
import type { Task } from "@/types/task.types";

export interface AutoArchiveResult {
  archived: Task[];
  at: string;
}

export class ArchiveService {
  private taskService: TaskService;
  private actionLogService: ActionLogService;
  private lastRun: { at: string; count: number } | null = null;

  constructor(taskService?: TaskService, actionLogService?: ActionLogService) {
    this.taskService = taskService ?? new TaskService();
    this.actionLogService = actionLogService ?? new ActionLogService();
  }

  async runAutoArchive(thresholdDays = 7): Promise<AutoArchiveResult> {
    const at = new Date().toISOString();
    const result = await this.taskService.autoArchiveStaleDone(thresholdDays);
    this.lastRun = { at, count: result.archived.length };

    const log = await this.actionLogService.logRequest("[system:auto_archive]", "auto_archive");
    await this.actionLogService.logToolExecution(log.id, "auto_archive", {
      thresholdDays,
      at,
    });
    await this.actionLogService.logSuccess(log.id, {
      archivedTaskIds: result.archived.map((task) => task.id),
      count: result.archived.length,
    });

    return { archived: result.archived, at };
  }

  async getLastRun(): Promise<{ at: string; count: number } | null> {
    return this.lastRun;
  }
}
