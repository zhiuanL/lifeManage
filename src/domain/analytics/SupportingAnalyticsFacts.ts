import type { Habit, HabitLog } from "../habits/Habit";
import { calculateHabitPeriodProgress, type HabitPeriodProgress } from "../habits/HabitPeriodProgress";
import { issueStatuses, type Issue, type IssueStatus } from "../issues/Issue";
import { isPlainDate, type Goal } from "../planning/Goal";
import type { Review } from "../reviews/Review";
import { reviewTypes, type ReviewType } from "../reviews/ReviewStructure";
import type { AnalyticsFilter, AnalyticsRecord } from "./Analytics";

export interface HabitAnalyticsWeek {
  start: string;
  end: string;
  completedDays: number;
  records: readonly HabitLog[];
  progress: HabitPeriodProgress;
}

export interface HabitAnalyticsFact {
  habit: Habit;
  records: readonly HabitLog[];
  progress: HabitPeriodProgress;
  weeks: readonly HabitAnalyticsWeek[];
}

export interface ReviewAnalyticsGroup {
  type: ReviewType | "unclassified";
  drafts: AnalyticsRecord[];
  completed: AnalyticsRecord[];
  unclassified: AnalyticsRecord[];
}

export interface SupportingAnalyticsFacts {
  habits: HabitAnalyticsFact[];
  reviewGroups: ReviewAnalyticsGroup[];
  issueStates: { status: IssueStatus; issues: Issue[] }[];
  firstSeenIssues: Issue[];
}

export function buildSupportingAnalyticsFacts(data: {
  habits: readonly Habit[];
  logs: readonly HabitLog[];
  reviews: readonly Review[];
  issues: readonly Issue[];
  goals: readonly Goal[];
}, filter: AnalyticsFilter, weeks: readonly { start: string; end: string }[],
  today: string): SupportingAnalyticsFacts {
  const start = weeks[0].start;
  const end = weeks[weeks.length - 1].end;
  const inPeriod = (date: string) => isPlainDate(date) && date >= start && date <= end && date <= today;
  const inDomain = (ids: readonly string[]) => !filter.domainId || ids.includes(filter.domainId);
  const selectedGoal = data.goals.find(goal => goal.id === filter.goalId && inDomain(goal.domainIds));
  const validScope = !filter.goalId || Boolean(selectedGoal);
  const habitIds = new Set(selectedGoal?.habitProgress?.map(setting => setting.habitId) ?? []);
  const scopedHabits = validScope ? data.habits.filter(habit =>
    isPlainDate(habit.startOn) && habit.startOn <= end && inDomain(habit.domainIds) &&
    (!filter.goalId || habitIds.has(habit.id))) : [];
  const logsByHabit = new Map<string, HabitLog[]>();
  for (const log of data.logs) {
    if (!inPeriod(log.recordedOn)) continue;
    const records = logsByHabit.get(log.habitId) ?? [];
    records.push(log);
    logsByHabit.set(log.habitId, records);
  }
  const habits = scopedHabits.map((habit): HabitAnalyticsFact => {
    const byDate = new Map<string, HabitLog>();
    for (const record of logsByHabit.get(habit.id) ?? []) {
      if (record.recordedOn < habit.startOn) continue;
      const previous = byDate.get(record.recordedOn);
      if (!previous || record.updatedAt > previous.updatedAt) byDate.set(record.recordedOn, record);
    }
    const records = [...byDate.values()].sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));
    return {
      habit, records,
      progress: calculateHabitPeriodProgress(habit, records, start, end, today),
      weeks: weeks.map(week => {
        const weekRecords = records.filter(record => record.recordedOn >= week.start && record.recordedOn <= week.end);
        return {
          ...week, records: weekRecords,
          completedDays: weekRecords.filter(record => record.completed).length,
          progress: calculateHabitPeriodProgress(habit, weekRecords, week.start, week.end, today),
        };
      }),
    };
  }).sort((a, b) => a.habit.title.localeCompare(b.habit.title, "zh-CN") || a.habit.id.localeCompare(b.habit.id));

  const reviewGroups: ReviewAnalyticsGroup[] = [...reviewTypes, "unclassified" as const].map(type => ({
    type, drafts: [], completed: [], unclassified: [],
  }));
  if (validScope) for (const review of data.reviews) {
    if (!inPeriod(review.reviewedOn) || !inDomain(review.domainIds) ||
        (filter.goalId && !review.goalIds?.includes(filter.goalId))) continue;
    const group = reviewGroups.find(item => item.type === (review.structure?.type ?? "unclassified"))!;
    const record = {
      id: review.id, title: review.title, date: review.reviewedOn,
      to: `/reviews#review-${encodeURIComponent(review.id)}`,
    };
    if (!review.structure) group.unclassified.push(record);
    else if (review.structure.status === "completed") group.completed.push(record);
    else group.drafts.push(record);
  }
  for (const group of reviewGroups) {
    for (const records of [group.drafts, group.completed, group.unclassified]) {
      records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    }
  }

  const goalsById = new Map(data.goals.map(goal => [goal.id, goal]));
  const issues = validScope ? data.issues.filter(issue =>
    isPlainDate(issue.firstSeen) && issue.firstSeen <= today &&
    (!filter.goalId || issue.goalId === filter.goalId) &&
    (inDomain(issue.domainIds) || (issue.goalId !== null &&
      inDomain(goalsById.get(issue.goalId)?.domainIds ?? [])))) : [];
  return {
    habits, reviewGroups,
    issueStates: issueStatuses.map(status => ({ status, issues: issues.filter(issue => issue.status === status) })),
    firstSeenIssues: issues.filter(issue => inPeriod(issue.firstSeen))
      .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || a.id.localeCompare(b.id)),
  };
}
