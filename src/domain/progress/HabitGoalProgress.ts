import type { Habit, HabitLog } from "../habits/Habit";
import { calculateHabitPeriodProgress, type HabitPeriodProgress } from "../habits/HabitPeriodProgress";
import { isPlainDate } from "../planning/Goal";

export interface HabitGoalProgressSetting {
  habitId: string;
  startOn: string;
  endOn: string;
  weeklyTarget: number;
  weight: number;
}

export interface HabitGoalContribution extends HabitPeriodProgress {
  habitId: string;
  weight: number;
}

export interface HabitGoalProgress {
  percent: number | null;
  contributions: readonly HabitGoalContribution[];
}

export function normalizeHabitGoalSettings(
  settings: readonly HabitGoalProgressSetting[],
): HabitGoalProgressSetting[] {
  if (!Array.isArray(settings) || settings.length < 1 || settings.length > 30) {
    throw new Error("习惯型目标请关联 1 至 30 个习惯。");
  }
  const ids = new Set<string>();
  return Array.from(settings).map((setting) => {
    if (!setting || typeof setting !== "object" || typeof setting.habitId !== "string") {
      throw new Error("关联的习惯无效。");
    }
    const habitId = setting.habitId.trim();
    if (!habitId || ids.has(habitId)) throw new Error("关联的习惯缺失或重复。");
    ids.add(habitId);
    if (typeof setting.startOn !== "string" || typeof setting.endOn !== "string" ||
        !isPlainDate(setting.startOn) || !isPlainDate(setting.endOn) ||
        setting.startOn > setting.endOn) {
      throw new Error("统计周期请填写有效的开始和结束日期，开始日期不能晚于结束日期。");
    }
    if (!Number.isInteger(setting.weeklyTarget) ||
        setting.weeklyTarget < 1 || setting.weeklyTarget > 7) {
      throw new Error("每周期望次数请填写 1 至 7 的整数。");
    }
    if (!Number.isFinite(setting.weight) || setting.weight <= 0 || setting.weight > 100) {
      throw new Error("习惯权重须大于 0 且不超过 100。");
    }
    return { habitId, startOn: setting.startOn, endOn: setting.endOn,
      weeklyTarget: setting.weeklyTarget, weight: setting.weight };
  });
}

export function calculateHabitGoalProgress(
  settings: readonly HabitGoalProgressSetting[],
  habits: readonly Habit[],
  logs: readonly HabitLog[],
  today: string,
): HabitGoalProgress {
  const normalized = normalizeHabitGoalSettings(settings);
  if (!isPlainDate(today)) throw new Error("计算日期无效。");
  const byId = new Map(habits.map((habit) => [habit.id, habit]));
  const contributions = normalized.map((setting): HabitGoalContribution => {
    const habit = byId.get(setting.habitId);
    const progress = habit
      ? calculateHabitPeriodProgress({ ...habit, weeklyTarget: setting.weeklyTarget },
        logs, setting.startOn, setting.endOn, today)
      : { percent: null, completed: 0, expected: 0, recordedWeeks: 0 };
    return { habitId: setting.habitId, weight: setting.weight, ...progress };
  });
  // Missing facts remain unknown; round only after weighting the original ratios.
  const percent = contributions.every((item) => item.expected > 0)
    ? Math.round(contributions.reduce((sum, item) =>
      sum + item.completed / item.expected * item.weight, 0) /
      contributions.reduce((sum, item) => sum + item.weight, 0) * 100)
    : null;
  return { percent, contributions };
}
