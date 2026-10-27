import type { Issue } from "../issues/Issue";
import type { Action } from "../planning/Action";
import { planReasonLabels, planReasons, type ActionCompletionPlan, type ActionPlanChange } from "../planning/ActionPlanChange";
import { actionFeedbackFields, type ActionDetails } from "../planning/ActionDetails";
import { groupIncompleteReasons } from "../planning/ActionFeedbackFacts";
import type { ActionStateEvent } from "../planning/ActionStateEvent";
import type { Goal } from "../planning/Goal";
import type { Review } from "../reviews/Review";
import type { Habit, HabitLog } from "../habits/Habit";
import { evaluateActionDueOutcomes } from "./ActionDueRate";
import { buildSupportingAnalyticsFacts, type SupportingAnalyticsFacts } from "./SupportingAnalyticsFacts";

export type AnalyticsWeeks = 4 | 8 | 12;

export interface AnalyticsFilter {
  weeks: AnalyticsWeeks;
  domainId: string | null;
  goalId: string | null;
}

export interface AnalyticsData {
  goals: readonly Goal[];
  actions: readonly Action[];
  reviews: readonly Review[];
  issues: readonly Issue[];
  planChanges: readonly ActionPlanChange[];
  completionPlans: readonly ActionCompletionPlan[];
  stateEvents: readonly ActionStateEvent[];
  habits?: readonly Habit[];
  habitLogs?: readonly HabitLog[];
}

export interface AnalyticsRecord {
  id: string;
  title: string;
  date: string;
  to: string;
}

export interface AnalyticsWeek {
  start: string;
  end: string;
  planned: AnalyticsRecord[];
  completed: AnalyticsRecord[];
  due: AnalyticsRecord[];
  onTime: AnalyticsRecord[];
  goalsCompleted: AnalyticsRecord[];
  reviews: AnalyticsRecord[];
}

export interface PlanChangeEvidence extends AnalyticsRecord {
  beforeDate: string | null;
  afterDate: string | null;
  reason: string;
  note: string;
}

export interface PlanComparison extends AnalyticsRecord {
  plannedDate: string;
  actualDate: string;
  differenceDays: number;
}

export interface AnalyticsSnapshot extends SupportingAnalyticsFacts {
  weeks: AnalyticsWeek[];
  openIssues: readonly Issue[];
  changes: PlanChangeEvidence[];
  comparisons: PlanComparison[];
  feedback: ActionFeedbackEvidence[];
  feedbackMinutes: number | string | null;
  feedbackMinutesCount: number;
  incompleteReasons: { reason: string; records: AnalyticsRecord[] }[];
  planReasons: { reason: string; records: PlanChangeEvidence[] }[];
}

export interface ActionFeedbackEvidence extends AnalyticsRecord {
  status: Action["status"];
  completedOn: string | null;
  details: Partial<ActionDetails>;
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timestampDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : localDate(date);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function buildAnalytics(
  data: AnalyticsData,
  filter: AnalyticsFilter,
  now: Date,
): AnalyticsSnapshot {
  if (![4, 8, 12].includes(filter.weeks) || Number.isNaN(now.getTime())) {
    throw new Error("请选择有效的观察周期。");
  }

  const today = localDate(now);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const first = addDays(monday, -7 * (filter.weeks - 1));
  const weeks: AnalyticsWeek[] = Array.from({ length: filter.weeks }, (_, index) => {
    const start = addDays(first, index * 7);
    return {
      start: localDate(start),
      end: localDate(addDays(start, 6)) < today ? localDate(addDays(start, 6)) : today,
      planned: [],
      completed: [],
      due: [],
      onTime: [],
      goalsCompleted: [],
      reviews: [],
    };
  });

  const goalsById = new Map(data.goals.map((goal) => [goal.id, goal]));
  const actionsById = new Map(data.actions.map((action) => [action.id, action]));
  const completionPlansByAction = new Map(data.completionPlans.map((plan) => [plan.actionId, plan]));
  const stateEventsByAction = new Map<string, ActionStateEvent[]>();
  for (const event of data.stateEvents) {
    const history = stateEventsByAction.get(event.actionId) ?? [];
    history.push(event);
    stateEventsByAction.set(event.actionId, history);
  }
  const lastDueDate = localDate(addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -1));
  const goalInScope = (goal: Goal) =>
    (!filter.domainId || goal.domainIds.includes(filter.domainId)) &&
    (!filter.goalId || goal.id === filter.goalId);
  const selectedGoalExists = !filter.goalId || data.goals.some(goalInScope);
  const inDomain = (action: Action) =>
    !filter.domainId || action.domainIds.includes(filter.domainId) ||
    (action.goalId !== null &&
      (goalsById.get(action.goalId)?.domainIds.includes(filter.domainId) ?? false));
  const weekFor = (date: string | null): AnalyticsWeek | undefined =>
    date && date <= today ? weeks.find((week) => date >= week.start && date <= week.end) : undefined;
  const changes: PlanChangeEvidence[] = [];
  const comparisons: PlanComparison[] = [];
  const feedback: ActionFeedbackEvidence[] = [];
  const feedbackActions: Action[] = [];
  const reasonChanges = new Map<string, PlanChangeEvidence[]>();

  if (selectedGoalExists) {
    for (const goal of data.goals) {
      if (!goalInScope(goal) || (goal.status !== "completed" &&
          !(goal.status === "archived" && goal.completedAt))) continue;
      const date = timestampDate(goal.completedAt);
      const week = weekFor(date);
      if (week && date) {
        week.goalsCompleted.push({
          id: goal.id, title: goal.title, date, to: `/goals#goal-${encodeURIComponent(goal.id)}`,
        });
      }
    }

    for (const action of data.actions) {
      if ((filter.goalId && action.goalId !== filter.goalId) ||
          !inDomain(action)) continue;
      const to = `/goals#action-${encodeURIComponent(action.id)}`;
      const updatedOn = timestampDate(action.updatedAt);
      if (updatedOn && weekFor(updatedOn) && Date.parse(action.updatedAt) <= now.getTime() &&
          action.details && (action.details.actualMinutes != null ||
            actionFeedbackFields.some(([key]) => Boolean(action.details?.[key]?.trim())))) {
        feedback.push({
          id: action.id, title: action.title, date: updatedOn, to, status: action.status,
          completedOn: timestampDate(action.completedAt), details: { ...action.details },
        });
        feedbackActions.push(action);
      }
      for (const outcome of evaluateActionDueOutcomes(
        stateEventsByAction.get(action.id) ?? [], lastDueDate,
      )) {
        const week = weekFor(outcome.dueDate);
        if (!week) continue;
        const record = {
          id: `${action.id}:${outcome.dueDate}`, title: action.title,
          date: outcome.dueDate, to,
        };
        week.due.push(record);
        if (outcome.onTime) week.onTime.push(record);
      }
      const planned = weekFor(action.scheduledFor);
      if (planned && action.scheduledFor) {
        planned.planned.push({ id: action.id, title: action.title, date: action.scheduledFor, to });
      }
      if (action.status === "completed") {
        const date = timestampDate(action.completedAt);
        const completed = weekFor(date);
        if (completed && date) {
          completed.completed.push({ id: action.id, title: action.title, date, to });
          const plan = completionPlansByAction.get(action.id);
          if (plan?.completedAt === action.completedAt && plan.plannedDate) {
            const differenceDays = (Date.parse(`${date}T00:00:00Z`) -
              Date.parse(`${plan.plannedDate}T00:00:00Z`)) / 86400000;
            comparisons.push({
              id: action.id, title: action.title, date, to,
              plannedDate: plan.plannedDate, actualDate: date, differenceDays,
            });
          }
        }
      }
    }
    for (const change of data.planChanges) {
      if (change.reason === "initial") continue;
      const action = actionsById.get(change.actionId);
      if (!action || (filter.goalId && action.goalId !== filter.goalId) ||
          !inDomain(action)) continue;
      const date = timestampDate(change.changedAt);
      if (!weekFor(date) || !date || Date.parse(change.changedAt) > now.getTime()) continue;
      const evidence: PlanChangeEvidence = {
        id: String(change.id), title: action.title, date,
        to: `/goals#action-${encodeURIComponent(action.id)}`,
        beforeDate: change.beforeDate, afterDate: change.afterDate,
        reason: planReasonLabels[change.reason], note: change.note,
      };
      changes.push(evidence);
      const records = reasonChanges.get(change.reason) ?? [];
      records.push(evidence);
      reasonChanges.set(change.reason, records);
    }
  }

  if (selectedGoalExists) {
    for (const review of data.reviews) {
      if ((filter.domainId && !review.domainIds.includes(filter.domainId)) ||
          (filter.goalId && !review.goalIds?.includes(filter.goalId))) continue;
      const week = weekFor(review.reviewedOn);
      if (week) {
        week.reviews.push({
          id: review.id, title: review.title, date: review.reviewedOn,
          to: `/reviews#review-${encodeURIComponent(review.id)}`,
        });
      }
    }
  }

  const supportingFacts = buildSupportingAnalyticsFacts({
    goals: data.goals, reviews: data.reviews, issues: data.issues,
    habits: data.habits ?? [], logs: data.habitLogs ?? [],
  }, filter, weeks, today);
  const openIssues = supportingFacts.issueStates.filter(group => group.status !== "resolved")
    .flatMap(group => group.issues);

  const minuteRecords = feedback.filter(item => typeof item.details.actualMinutes === "number" &&
    Number.isSafeInteger(item.details.actualMinutes) && item.details.actualMinutes >= 0);
  const totalMinutes = minuteRecords.reduce((sum, item) => sum + BigInt(item.details.actualMinutes!), 0n);
  return {
    ...supportingFacts,
    weeks, openIssues, changes, comparisons,
    feedback: feedback.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "zh-CN")),
    feedbackMinutes: minuteRecords.length
      ? totalMinutes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(totalMinutes) : totalMinutes.toString()
      : null,
    feedbackMinutesCount: minuteRecords.length,
    incompleteReasons: groupIncompleteReasons(feedbackActions).map(group => ({
      reason: group.reason,
      records: group.actions.map(action => ({
        id: action.id, title: action.title, date: timestampDate(action.updatedAt)!,
        to: `/goals#action-${encodeURIComponent(action.id)}`,
      })),
    })),
    planReasons: planReasons.filter(reason => reasonChanges.has(reason)).map(reason => ({
      reason: planReasonLabels[reason], records: reasonChanges.get(reason)!,
    })),
  };
}
