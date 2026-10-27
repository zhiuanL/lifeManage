import type { GoalProgressItem } from "../../domain/progress/GoalProgressItem";

export interface GoalProgressItemRepository {
  list(): Promise<readonly GoalProgressItem[]>;
  replace(goalId: string, items: readonly GoalProgressItem[], updatedAt: string): Promise<void>;
}
