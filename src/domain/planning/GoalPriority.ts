export const goalPriorities = ["high", "medium", "low"] as const;
export type GoalPriority = (typeof goalPriorities)[number];
export const goalPriorityLabels: Record<GoalPriority, string> = {
  high: "高", medium: "中", low: "低",
};

export function normalizeGoalPriority(value: GoalPriority | undefined): GoalPriority {
  if (value === undefined) return "medium";
  if (!goalPriorities.includes(value)) throw new Error("请选择高、中、低中的一个目标优先级。");
  return value;
}
