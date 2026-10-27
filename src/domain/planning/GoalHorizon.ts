export const goalHorizons = ['annual', 'quarter', 'stage', 'month'] as const;
export type GoalHorizon = (typeof goalHorizons)[number];
export const goalHorizonLabels: Record<GoalHorizon, string> = {
  annual: '年度目标', quarter: '季度目标', stage: '阶段目标', month: '月度重点',
};
export function normalizeGoalHorizon(value?: GoalHorizon | null): GoalHorizon | null {
  if (value == null) return null;
  if (!goalHorizons.includes(value)) throw new Error('请选择有效的目标周期。');
  return value;
}
