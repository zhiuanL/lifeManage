import { localDate, type Habit, type HabitLog } from "../habits/Habit";
import { calculateHabitPeriodProgress } from "../habits/HabitPeriodProgress";
import { isPlainDate } from "../planning/Goal";
import type { AttentionRulePreference, AttentionSignal } from "./Attention";

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function rate(completed: number, expected: number): string {
  return (completed / expected * 100).toFixed(1).replace(/\.0$/, "");
}

export function findHabitDeclineSignals(
  habits: readonly Habit[], logs: readonly HabitLog[], preference: AttentionRulePreference,
  threshold: number, now: Date,
): AttentionSignal[] {
  if (!preference.enabled || !Number.isFinite(now.getTime())) return [];
  const today = localDate(now);
  if (!isPlainDate(today)) return [];
  const calendar = new Date(`${today}T00:00:00Z`);
  const currentMonday = shiftDate(today, -((calendar.getUTCDay() + 6) % 7));
  const latestEnd = shiftDate(currentMonday, -1);
  const latestStart = shiftDate(currentMonday, -28);
  const baselineEnd = shiftDate(latestStart, -1);
  const baselineStart = shiftDate(latestStart, -28);
  const lastWeekStart = shiftDate(currentMonday, -7);
  const signals: AttentionSignal[] = [];

  for (const habit of habits) {
    if (habit.archived || !isPlainDate(habit.startOn) ||
        !Number.isInteger(habit.weeklyTarget) || habit.weeklyTarget < 1 || habit.weeklyTarget > 7 ||
        (preference.scope === "domains" &&
          !preference.domainIds.some(id => habit.domainIds.includes(id)))) continue;
    const byDate = new Map<string, HabitLog>();
    for (const log of logs) {
      if (log.habitId !== habit.id || !isPlainDate(log.recordedOn) ||
          log.recordedOn < baselineStart || log.recordedOn < habit.startOn ||
          log.recordedOn > latestEnd || !Number.isFinite(Date.parse(log.updatedAt)) ||
          Date.parse(log.updatedAt) > now.getTime() || !Number.isFinite(Date.parse(log.createdAt)) ||
          Date.parse(log.createdAt) > now.getTime()) continue;
      const previous = byDate.get(log.recordedOn);
      if (!previous || Date.parse(log.updatedAt) > Date.parse(previous.updatedAt) ||
          (Date.parse(log.updatedAt) === Date.parse(previous.updatedAt) && log.id > previous.id)) {
        byDate.set(log.recordedOn, log);
      }
    }
    const records = [...byDate.values()].sort((a, b) =>
      a.recordedOn.localeCompare(b.recordedOn) || a.id.localeCompare(b.id));
    // Only evidence from complete weeks participates; a missing week remains unknown.
    const completeRecords = records.filter(log => {
      const date = new Date(`${log.recordedOn}T00:00:00Z`);
      return shiftDate(log.recordedOn, -((date.getUTCDay() + 6) % 7)) >= habit.startOn;
    });
    if (!completeRecords.some(log => log.recordedOn >= lastWeekStart)) continue;
    const baseline = calculateHabitPeriodProgress(habit, completeRecords, baselineStart, baselineEnd, today);
    const latest = calculateHabitPeriodProgress(habit, completeRecords, latestStart, latestEnd, today);
    if (baseline.recordedWeeks < 2 || latest.recordedWeeks < 2) continue;
    const denominator = baseline.expected * latest.expected;
    const numerator = baseline.completed * latest.expected - latest.completed * baseline.expected;
    if (numerator * 100 < threshold * denominator) continue;
    const decline = rate(numerator, denominator);
    signals.push({
      id: `habit-drop:${habit.id}`,
      kind: "habit-drop",
      title: habit.title,
      summary: `有记录完整周的完成比例由 ${rate(baseline.completed, baseline.expected)}% 降至 ${rate(latest.completed, latest.expected)}%，下降约 ${decline} 个百分点。`,
      rule: `前后两个四周窗口均至少有两周明确打卡，最近完整周有记录，完成比例下降至少 ${threshold} 个百分点；不计部分首周、未结束本周或空白周。`,
      baseline: `前四周 ${baselineStart} 至 ${baselineEnd}：${baseline.recordedWeeks} 个有记录完整周，计入完成 ${baseline.completed} / 期望 ${baseline.expected} 次。后四周 ${latestStart} 至 ${latestEnd}：${latest.recordedWeeks} 周，${latest.completed} / ${latest.expected} 次。两期均按当前每周期望 ${habit.weeklyTarget} 次计算，不代表历史频率；显式未完成可为零，缺失不补零，不推断原因。`,
      period: `${baselineStart} 至 ${latestEnd}`,
      domainIds: habit.domainIds,
      sources: [
        { id: habit.id, title: habit.title, date: habit.startOn, path: "/habits", fragment: `habit-${habit.id}` },
        ...completeRecords.map(log => ({
          id: log.id, title: `${log.recordedOn} · ${log.completed ? "已完成" : "未完成"}`,
          date: log.recordedOn, path: "/habits" as const, fragment: `habit-log-${log.id}`,
        })),
      ],
    });
  }
  return signals;
}
