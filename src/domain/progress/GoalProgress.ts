import type { Action } from "../planning/Action";
import type { Goal } from "../planning/Goal";
import type { GoalProgressItem } from "./GoalProgressItem";
import type { Habit, HabitLog } from "../habits/Habit";
import { calculateHabitGoalProgress, type HabitGoalContribution } from "./HabitGoalProgress";

export interface GoalProgress {
  percent: number | null;
  childGoalCount: number;
  actionCount: number;
  itemCount?: number;
  habitContributions?: readonly HabitGoalContribution[];
}

export function calculateGoalProgress(
  goals: readonly Goal[],
  actions: readonly Action[],
  items: readonly GoalProgressItem[] = [],
  habitContext?: { habits: readonly Habit[]; logs: readonly HabitLog[]; today: string },
): ReadonlyMap<string, GoalProgress> {
  const children = new Map<string, Goal[]>();
  const linkedActions = new Map<string, Action[]>();
  const byGoal = new Map<string, GoalProgressItem[]>();
  for (const item of items) {
    const group = byGoal.get(item.goalId) ?? [];
    group.push(item);
    byGoal.set(item.goalId, group);
  }
  for (const goal of goals) {
    if (goal.parentId) {
      const siblings = children.get(goal.parentId) ?? [];
      siblings.push(goal);
      children.set(goal.parentId, siblings);
    }
  }
  for (const action of actions) {
    if (action.goalId) {
      const siblings = linkedActions.get(action.goalId) ?? [];
      siblings.push(action);
      linkedActions.set(action.goalId, siblings);
    }
  }

  const result = new Map<string, GoalProgress>();
  const visiting = new Set<string>();
  const visit = (goal: Goal): GoalProgress => {
    const cached = result.get(goal.id);
    if (cached) return cached;
    const childGoals = children.get(goal.id) ?? [];
    const directActions = linkedActions.get(goal.id) ?? [];
    const progressItems = byGoal.get(goal.id) ?? [];
    const habitProgress = goal.habitProgress?.length
      ? habitContext ? calculateHabitGoalProgress(goal.habitProgress,
        habitContext.habits, habitContext.logs, habitContext.today)
        : { percent: null, contributions: [] }
      : null;
    if (visiting.has(goal.id)) {
      return { percent: null, childGoalCount: childGoals.length, actionCount: directActions.length };
    }
    visiting.add(goal.id);
    const contributions = progressItems.length ? [] : [
      ...childGoals.map((child) => ({ percent: visit(child).percent, weight: child.progressWeight ?? 1 })),
      ...directActions.map((action) => ({ percent: action.status === "completed" ? 100 : 0, weight: action.progressWeight ?? 1 })),
    ];
    visiting.delete(goal.id);
    const weighted = progressItems.length
      ? Math.round(progressItems.reduce((sum, item) =>
        sum + Math.min(item.currentValue / item.targetValue, 1) * item.weight, 0) /
        progressItems.reduce((sum, item) => sum + item.weight, 0) * 100)
      : null;
    const progress: GoalProgress = {
      percent: goal.progressMode === "exploration" ? null
        : goal.status === "completed" || (goal.status === "archived" && goal.completedAt) ? 100
        : habitProgress ? habitProgress.percent
        : progressItems.length ? weighted
          : contributions.length && contributions.every((value) => value.percent !== null)
          ? Math.round(contributions.reduce((sum, value) => sum + value.percent! * value.weight, 0) /
            contributions.reduce((sum, value) => sum + value.weight, 0))
          : null,
      childGoalCount: childGoals.length,
      actionCount: directActions.length,
      ...(progressItems.length ? { itemCount: progressItems.length } : {}),
      ...(habitProgress ? { habitContributions: habitProgress.contributions } : {}),
    };
    result.set(goal.id, progress);
    return progress;
  };
  goals.forEach(visit);
  return result;
}
