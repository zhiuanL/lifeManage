import type { ReviewStructure, ReviewPeriod } from "./ReviewStructure";
import { reviewTypes } from "./ReviewStructure";
import { appendStrategicReviewFacts, type StrategicReviewFactData } from "./StrategicReviewFacts";
import type { Review } from "./Review";
import { isActionInDomain, type Action } from "../planning/Action";
import { normalizeActionDetails } from "../planning/ActionDetails";
import { planReasonLabels, type ActionPlanChange } from "../planning/ActionPlanChange";
import { goalStatusLabels, type Goal } from "../planning/Goal";
import { calculateGoalProgress } from "../progress/GoalProgress";
import type { GoalProgressItem } from "../progress/GoalProgressItem";
import type { Habit, HabitLog } from "../habits/Habit";
import type { Issue } from "../issues/Issue";
import type { MetricDefinition, MetricRecord } from "../life/DomainMetric";

export interface ReviewFactData extends StrategicReviewFactData {
  reviews: readonly Review[]; actions: readonly Action[]; goals: readonly Goal[];
  items: readonly GoalProgressItem[]; issues: readonly Issue[];
  metrics: readonly MetricDefinition[]; records: readonly MetricRecord[];
  changes: readonly ActionPlanChange[];
  habits: readonly Habit[]; logs: readonly HabitLog[]; observedOn: string;
}
export interface ReviewFactDraft { answers: Readonly<Record<string, string>>; omitted: number }

export function buildReviewFactDraft(period: ReviewPeriod, data: ReviewFactData,
  domainIds: readonly string[] = [], excludeReviewId?: string): ReviewFactDraft {
  const inside = (date: string | null) => Boolean(date && date.slice(0, 10) >= period.start && date.slice(0, 10) <= period.end);
  const scoped = (ids: readonly string[]) => !domainIds.length || ids.some(id => domainIds.includes(id));
  const byGoal = new Map(data.goals.map(goal => [goal.id, goal]));
  const actions = data.actions.filter(action => !domainIds.length || domainIds.some(id => isActionInDomain(action, id, byGoal)));
  const lowerType = reviewTypes[reviewTypes.indexOf(period.type) - 1];
  const lines: Record<string, string[]> = {};
  const add = (key: string, line: string) => { (lines[key] ??= []).push(line); };
  const conclusionKey = { weekly: "execution", monthly: "weeklyConclusions", quarterly: "monthlyConclusions", annual: "quarterlyConclusions", daily: "completed" }[period.type];
  for (const review of [...data.reviews].sort((a, b) => a.reviewedOn.localeCompare(b.reviewedOn) || a.id.localeCompare(b.id))) {
    if (!review.structure || review.id === excludeReviewId || !scoped(review.domainIds) || review.structure?.type !== lowerType || !inside(review.reviewedOn)) continue;
    const structure = review.structure!;
    const content = structure.template.fields.filter(field => structure.answers[field.key]?.trim())
      .map(field => field.label + "：" + structure.answers[field.key]).join("；");
    add(conclusionKey, review.reviewedOn + "「" + review.title + "」" + (structure.status === "draft" ? "（草稿）" : "") + (content ? "：" + content : "（未填写正文）"));
  }
  const executionKey = { daily: "completed", weekly: "execution", monthly: "monthlyFocus", quarterly: "stageGoals", annual: "annualGoals" }[period.type];
  for (const action of [...actions].sort((a, b) => a.id.localeCompare(b.id))) {
    const done = inside(action.completedAt);
    const pending = action.status === "open" && inside(action.scheduledFor);
    if (!done && !pending) continue;
    const feedback = normalizeActionDetails(action.details);
    const line = (done ? action.completedAt!.slice(0, 10) + " 完成" : action.scheduledFor + " 计划；当前未完成") + "「" + action.title + "」";
    add(period.type === "daily" && pending ? "incomplete" : executionKey, line + (feedback.actualResult ? "；当前反馈：" + feedback.actualResult : "") + (feedback.actualMinutes !== null ? "；当前投入 " + feedback.actualMinutes + " 分钟" : ""));
    if (pending && feedback.incompleteReason) add(period.type === "daily" ? "incompleteReasons" : executionKey, action.title + "；当前未完成原因：" + feedback.incompleteReason);
    if (period.type === "daily" && feedback.learning) add("learning", action.title + "：" + feedback.learning);
    if (period.type === "daily" && feedback.nextAdjustment) add("nextAdjustment", action.title + "：" + feedback.nextAdjustment);
  }
  if (period.type !== "daily") {
    const progress = calculateGoalProgress(data.goals, data.actions, data.items, { habits: data.habits, logs: data.logs, today: data.observedOn });
    const goalKey = { weekly: "goalProgress", monthly: "monthlyFocus", quarterly: "stageGoals", annual: "annualGoals" }[period.type];
    for (const goal of data.goals.filter(goal => scoped(goal.domainIds) && goal.createdAt.slice(0, 10) <= period.end && (goal.status === "active" || inside(goal.completedAt) || inside(goal.updatedAt)))) {
      const percent = progress.get(goal.id)?.percent;
      add(goalKey, "当前快照（" + data.observedOn + "）「" + goal.title + "」：" + goalStatusLabels[goal.status] + "；进度 " + (percent == null ? "未知" : Math.round(percent) + "%"));
    }
    for (const issue of data.issues.filter(issue => scoped(issue.domainIds) && (inside(issue.firstSeen) || inside(issue.updatedAt)))) {
      add(period.type === "weekly" ? "recurringIssues" : period.type === "monthly" ? "issueEvolution" : executionKey,
        "「" + issue.title + "」首次发现 " + issue.firstSeen + "；当前累计 " + issue.occurrenceCount + " 次（非周期次数）；" + ({ open: "待处理", watching: "观察中", resolved: "已解决" }[issue.status]) + (issue.followUp ? "；当前后续：" + issue.followUp : ""));
    }
  }
  if (period.type === "weekly") for (const change of [...data.changes].sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.id - b.id)) {
    const action = actions.find(action => action.id === change.actionId);
    if (!action || change.reason === "initial" || !inside(change.changedAt)) continue;
    add("planChanges", change.changedAt.slice(0, 10) + "「" + action.title + "」：" + (change.beforeDate ?? "未安排") + " → " + (change.afterDate ?? "未安排") + "；" + planReasonLabels[change.reason] + (change.note ? "；" + change.note : ""));
  }
  const metricKey = { daily: "state", weekly: "domainState", monthly: "domainTrends", quarterly: "domainState", annual: "domainChanges" }[period.type];
  for (const metric of data.metrics.filter(metric => scoped(metric.domainIds))) {
    for (const record of [...data.records].filter(record => record.metricId === metric.id && inside(record.recordedOn)).sort((a, b) => a.recordedOn.localeCompare(b.recordedOn) || a.id.localeCompare(b.id))) {
      add(metricKey, record.recordedOn + " " + metric.name + "：" + record.value + " " + metric.unit + (record.note ? "；" + record.note : ""));
    }
  }
  appendStrategicReviewFacts(period, data, domainIds, add);
  let omitted = 0;
  const answers = Object.fromEntries(Object.entries(lines).map(([key, values]) => {
    const kept: string[] = []; let length = 0;
    for (const value of values) {
      if (length + value.length + (kept.length ? 1 : 0) > 11000) { omitted++; continue; }
      kept.push(value); length += value.length + (kept.length > 1 ? 1 : 0);
    }
    return [key, kept.join("\n")];
  }));
  return { answers, omitted };
}

export function applyReviewFactDraft(structure: ReviewStructure, facts: ReviewFactDraft): ReviewStructure {
  const answers = { ...structure.answers };
  for (const field of structure.template.fields) {
    if (!answers[field.key]?.trim() && facts.answers[field.key]) answers[field.key] = facts.answers[field.key];
  }
  return { ...structure, answers };
}
