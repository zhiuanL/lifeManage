import type { Goal } from "../../domain/planning/Goal";
import type { GoalProgressItem } from "../../domain/progress/GoalProgressItem";

export interface GoalRepository {
  list(): Promise<readonly Goal[]>;
  findById(id: string): Promise<Goal | null>;
  create(goal: Goal, progressItems?: readonly GoalProgressItem[]): Promise<void>;
  update(goal: Goal): Promise<void>;
}
