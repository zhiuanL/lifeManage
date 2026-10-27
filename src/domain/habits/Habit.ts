import { isPlainDate } from "../planning/Goal";

export class HabitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HabitValidationError";
  }
}

export interface HabitDraft {
  title: string;
  intention: string;
  weeklyTarget: number;
  stableContext: string;
  triggerCondition: string;
  obstacle: string;
  adjustment: string;
  startOn: string;
  domainIds: readonly string[];
}

export interface Habit extends HabitDraft {
  id: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HabitLog {
  id: string;
  habitId: string;
  recordedOn: string;
  completed: boolean;
  obstacle: string;
  adjustment: string;
  createdAt: string;
  updatedAt: string;
}

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function normalizeHabit(draft: HabitDraft, today: string): HabitDraft {
  const title = draft.title.trim();
  if (!title || title.length > 80) throw new HabitValidationError("习惯名称请填写 1 至 80 个字符。");
  if (!Number.isInteger(draft.weeklyTarget) || draft.weeklyTarget < 1 || draft.weeklyTarget > 7) {
    throw new HabitValidationError("每周期望次数请填写 1 至 7 的整数。");
  }
  if (!isPlainDate(draft.startOn) || draft.startOn > today) {
    throw new HabitValidationError("开始日期请填写有效且不晚于今天的日期。");
  }
  const fields = {
    intention: draft.intention.trim(), stableContext: draft.stableContext.trim(),
    triggerCondition: draft.triggerCondition.trim(), obstacle: draft.obstacle.trim(),
    adjustment: draft.adjustment.trim(),
  };
  if (Object.values(fields).some((value) => value.length > 500)) {
    throw new HabitValidationError("习惯说明请控制在每项 500 字以内。");
  }
  const domainIds = draft.domainIds.map((id) => id.trim());
  if (domainIds.some((id) => !id) || new Set(domainIds).size !== domainIds.length) {
    throw new HabitValidationError("关联的生活领域无效。");
  }
  return { title, weeklyTarget: draft.weeklyTarget, startOn: draft.startOn,
    domainIds, ...fields };
}

export function normalizeLog(date: string, obstacle: string, adjustment: string,
  startOn: string, today: string) {
  if (!isPlainDate(date) || date < startOn || date > today) {
    throw new HabitValidationError("打卡日期须在习惯开始日与今天之间。");
  }
  if (obstacle.trim().length > 500 || adjustment.trim().length > 500) {
    throw new HabitValidationError("阻碍和调整请分别控制在 500 字以内。");
  }
  return { recordedOn: date, obstacle: obstacle.trim(), adjustment: adjustment.trim() };
}

export interface HabitSummary {
  currentWeek: number;
  completedWeeks: number;
  eligibleWeeks: number;
  completionRate: number | null;
  consecutiveWeeks: number;
}

function monday(date: string): Date {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function summarizeHabit(habit: Habit, logs: readonly HabitLog[], today: string): HabitSummary {
  const currentMonday = monday(today);
  const start = monday(habit.startOn);
  const completed = new Set(logs.filter((log) => log.completed &&
    log.recordedOn >= habit.startOn && log.recordedOn <= today).map((log) => log.recordedOn));
  const weekCount = (week: Date) => [...completed].filter((date) =>
    date >= iso(week) && date < iso(new Date(week.getTime() + 7 * 86400000))).length;
  let earned = 0;
  let eligibleWeeks = 0;
  let consecutiveWeeks = 0;
  let stillConsecutive = true;
  // A partial first week and the current unfinished week are not judged.
  for (let offset = 1; offset <= 4; offset++) {
    const week = new Date(currentMonday.getTime() - offset * 7 * 86400000);
    if (week < start || iso(week) < habit.startOn) break;
    eligibleWeeks++;
    const count = Math.min(weekCount(week), habit.weeklyTarget);
    earned += count;
    if (stillConsecutive && count >= habit.weeklyTarget) consecutiveWeeks++;
    else stillConsecutive = false;
  }
  return {
    currentWeek: weekCount(currentMonday),
    completedWeeks: earned, eligibleWeeks,
    completionRate: eligibleWeeks ? Math.round(earned / (eligibleWeeks * habit.weeklyTarget) * 100) : null,
    consecutiveWeeks,
  };
}
