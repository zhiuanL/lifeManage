export const goalProgressModes = ["automatic", "exploration", "exploration_percent"] as const;
export type GoalProgressMode = (typeof goalProgressModes)[number];

export const goalProgressModeLabels: Record<GoalProgressMode, string> = {
  automatic: "自动计算", exploration: "探索型（不显示百分比）",
  exploration_percent: "探索型（显示百分比）",
};

export function normalizeGoalProgressMode(value: unknown): GoalProgressMode {
  if (value === undefined) return "automatic";
  if (!goalProgressModes.includes(value as GoalProgressMode)) {
    throw new Error("请选择有效的目标进度方式。");
  }
  return value as GoalProgressMode;
}
