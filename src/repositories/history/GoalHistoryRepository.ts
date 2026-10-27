import type { GoalVersionFact } from "../../domain/records/GoalTimeline";

export interface GoalHistoryRepository {
  listGoalVersions(): Promise<readonly GoalVersionFact[]>;
}
