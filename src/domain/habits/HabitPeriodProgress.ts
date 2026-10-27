import { isPlainDate } from "../planning/Goal";
import type { Habit, HabitLog } from "./Habit";

export interface HabitPeriodProgress {
  percent: number | null;
  completed: number;
  expected: number;
  recordedWeeks: number;
}

export function calculateHabitPeriodProgress(
  habit: Habit, logs: readonly HabitLog[], startOn: string, endOn: string, today: string,
): HabitPeriodProgress {
  if (![startOn, endOn, today].every(isPlainDate) || startOn > endOn) {
    throw new Error("统计周期请填写有效的开始和结束日期，开始日期不能晚于结束日期。");
  }
  const earliest = startOn > habit.startOn ? startOn : habit.startOn;
  const latest = endOn < today ? endOn : today;
  const weeks = new Map<string, Set<string>>();
  for (const log of logs) {
    if (log.habitId !== habit.id || !isPlainDate(log.recordedOn) ||
        log.recordedOn < earliest || log.recordedOn > latest) continue;
    const monday = new Date(`${log.recordedOn}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const weekStart = monday.toISOString().slice(0, 10);
    const sunday = new Date(monday.getTime() + 6 * 86400000).toISOString().slice(0, 10);
    if (weekStart < earliest || sunday > latest || sunday >= today) continue;
    const days = weeks.get(weekStart) ?? new Set<string>();
    if (log.completed) days.add(log.recordedOn);
    weeks.set(weekStart, days);
  }
  const completed = [...weeks.values()].reduce((sum, days) =>
    sum + Math.min(days.size, habit.weeklyTarget), 0);
  const expected = weeks.size * habit.weeklyTarget;
  return {
    percent: expected ? Math.round(completed / expected * 100) : null,
    completed, expected, recordedWeeks: weeks.size,
  };
}
