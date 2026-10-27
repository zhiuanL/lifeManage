import type { Habit, HabitLog } from "../habits/Habit";
import type { LifeEvent } from "../records/LifeRecords";
import type { Review } from "../reviews/Review";
import { reviewTypeLabels } from "../reviews/ReviewStructure";
import type { Action } from "./Action";
import { isPlainDate, goalStatusLabels, type Goal } from "./Goal";
import { goalHorizonLabels } from "./GoalHorizon";

export const calendarKinds = ["action", "goal", "habit", "review", "event"] as const;
export type CalendarKind = (typeof calendarKinds)[number];
export type CalendarView = "agenda" | "week" | "month";
export const calendarKindLabels: Record<CalendarKind, string> = {
  action: "行动", goal: "目标截止", habit: "习惯", review: "复盘", event: "重要事件",
};
export interface CalendarSources {
  actions: readonly Action[]; goals: readonly Goal[]; habits: readonly Habit[];
  logs: readonly HabitLog[]; reviews: readonly Review[]; events: readonly LifeEvent[];
}
export interface CalendarEntry {
  id: string; sourceId: string; kind: CalendarKind; date: string; title: string;
  detail: string; domainIds: readonly string[]; href: string; completed: boolean;
}
export function shiftCalendarDate(date: string, days: number): string {
  if (!isPlainDate(date)) throw new Error("请选择有效的日历日期。");
  const result = new Date(date + "T12:00:00Z");
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
export function calendarDates(anchor: string, view: CalendarView): string[] {
  if (!isPlainDate(anchor)) throw new Error("请选择有效的日历日期。");
  const date = new Date(anchor + "T12:00:00Z");
  const monday = shiftCalendarDate(anchor, -((date.getUTCDay() + 6) % 7));
  if (view !== "month") return Array.from({ length: 7 }, (_, i) => shiftCalendarDate(monday, i));
  const first = anchor.slice(0, 7) + "-01";
  const firstDay = new Date(first + "T12:00:00Z").getUTCDay();
  const start = shiftCalendarDate(first, -((firstDay + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => shiftCalendarDate(start, i));
}
export function moveCalendarAnchor(anchor: string, view: CalendarView, direction: number): string {
  if (view !== "month") return shiftCalendarDate(anchor, direction * 7);
  if (!isPlainDate(anchor)) throw new Error("请选择有效的日历日期。");
  const date = new Date(anchor.slice(0, 7) + "-01T12:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}
export function buildCalendarEntries(
  data: CalendarSources, dates: readonly string[], domainId = "", kinds: readonly CalendarKind[] = calendarKinds,
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  const includedDates = new Set(dates);
  const goals = new Map(data.goals.map(goal => [goal.id, goal]));
  const linkedDomains = (ids: readonly string[], goalId?: string | null) =>
    [...new Set([...ids, ...(goalId ? goals.get(goalId)?.domainIds ?? [] : [])])];
  const add = (entry: CalendarEntry) => {
    if (includedDates.has(entry.date) && kinds.includes(entry.kind) &&
      (!domainId || entry.domainIds.includes(domainId))) entries.push(entry);
  };
  for (const action of data.actions) {
    if (!action.scheduledFor) continue;
    add({ id: "action-" + action.id, sourceId: action.id, kind: "action", date: action.scheduledFor,
      title: action.title, detail: action.status === "completed" ? "已完成" : "已安排",
      domainIds: linkedDomains(action.domainIds, action.goalId), href: "/goals#action-" + encodeURIComponent(action.id),
      completed: action.status === "completed" });
  }
  for (const goal of data.goals) {
    if (!goal.targetDate || ["archived", "abandoned"].includes(goal.status)) continue;
    add({ id: "goal-" + goal.id, sourceId: goal.id, kind: "goal", date: goal.targetDate, title: goal.title,
      detail: (goal.horizon ? goalHorizonLabels[goal.horizon] : "目标") + " · " + goalStatusLabels[goal.status],
      domainIds: goal.domainIds, href: "/goals/" + encodeURIComponent(goal.id), completed: goal.status === "completed" });
  }
  for (const review of data.reviews) {
    add({ id: "review-" + review.id, sourceId: review.id, kind: "review", date: review.reviewedOn,
      title: review.title, detail: review.structure ?
        reviewTypeLabels[review.structure.type] + " · " + (review.structure.status === "completed" ? "已完成" : "草稿") +
        " · " + review.structure.start + "至" + review.structure.end : "回顾记录",
      domainIds: [...new Set([...review.domainIds, ...(review.goalIds ?? []).flatMap(id => goals.get(id)?.domainIds ?? [])])],
      href: "/reviews#review-" + encodeURIComponent(review.id), completed: review.structure?.status === "completed" });
  }
  for (const event of data.events) {
    add({ id: "event-" + event.id, sourceId: event.id, kind: "event", date: event.happenedOn,
      title: event.title, detail: event.archived ? "已归档事件" : "事件记录",
      domainIds: linkedDomains(event.domainIds, event.goalId), href: "/timeline#event-" + encodeURIComponent(event.id), completed: false });
  }
  const logsByHabit = new Map<string, HabitLog[]>();
  for (const log of data.logs) {
    const logs = logsByHabit.get(log.habitId) ?? [];
    logs.push(log); logsByHabit.set(log.habitId, logs);
  }
  for (const habit of data.habits) {
    const href = "/habits#habit-" + encodeURIComponent(habit.id);
    for (const log of logsByHabit.get(habit.id) ?? []) {
      add({ id: "habit-log-" + log.id, sourceId: habit.id, kind: "habit", date: log.recordedOn,
        title: habit.title, detail: log.completed ? "打卡完成" : "打卡记录 · 未完成",
        domainIds: habit.domainIds, href: "/habits#habit-log-" + encodeURIComponent(log.id), completed: log.completed });
    }
    if (habit.archived) continue;
    // Weekly frequency does not assign particular weekdays or clock times.
    for (const date of dates) {
      const weekday = new Date(date + "T12:00:00Z").getUTCDay();
      if ((weekday === 1 || date === habit.startOn) && date >= habit.startOn) {
        add({ id: "habit-plan-" + habit.id + "-" + date, sourceId: habit.id, kind: "habit", date,
          title: habit.title, detail: "本周安排 · 每周期望 " + habit.weeklyTarget + " 次",
          domainIds: habit.domainIds, href, completed: false });
      }
    }
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date) ||
    calendarKinds.indexOf(a.kind) - calendarKinds.indexOf(b.kind) || a.title.localeCompare(b.title, "zh-CN") ||
    a.id.localeCompare(b.id));
}

