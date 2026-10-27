import { buildGoalTimeline, type GoalTimelineEntry } from "../../domain/records/GoalTimeline";
import type { GoalHistoryRepository } from "../../repositories/history/GoalHistoryRepository";
import type { GoalRepository } from "../../repositories/planning/GoalRepository";
import type { GoalProgressItemRepository } from "../../repositories/planning/GoalProgressItemRepository";

export class GoalTimelineService {
  constructor(private readonly history: GoalHistoryRepository,
    private readonly goals: GoalRepository, private readonly progress: GoalProgressItemRepository) {}

  async list(): Promise<readonly GoalTimelineEntry[]> {
    const history = await this.history.listGoalVersions();
    const [goals, progress] = await Promise.all([this.goals.list(), this.progress.list()]);
    const confirmed = await this.history.listGoalVersions();
    // Repository reads include multiple tables; reject a read crossed by a recorded mutation.
    if (JSON.stringify(history) !== JSON.stringify(confirmed)) {
      throw new Error("目标历史在读取期间发生变化，请重新读取。");
    }
    return buildGoalTimeline(goals, progress, history);
  }
}
