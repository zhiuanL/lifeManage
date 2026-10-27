import type { Issue } from "../issues/Issue";
import type { MetricDefinition, MetricRecord } from "../life/DomainMetric";
import type { Action } from "../planning/Action";
import { planReasonLabels, type ActionPlanChange } from "../planning/ActionPlanChange";
import type { Goal } from "../planning/Goal";
import { groupIncompleteReasons } from "../planning/ActionFeedbackFacts";
import type { Habit, HabitLog } from "../habits/Habit";
import { findHabitDeclineSignals } from "./HabitAttentionFacts";
import type { ResourceNeed } from "../resources/Resources";
import type { Decision } from "../decisions/Decision";
import { findResourceGapSignals, type ResourceAttentionNodeScope } from "./ResourceAttentionFacts";
import type { Review } from "../reviews/Review";
import type { LifeEvent } from "../records/LifeRecords";
import { findRecentEventSignals } from "./EventAttentionFacts";
import { reviewTypes, type ReviewType } from "../reviews/ReviewStructure";
import {
  defaultReviewAttentionTypes, findReviewDraftSignals, findScheduledReviewSignals,
  validateReviewSchedule, type ReviewSchedule,
} from "./ReviewAttentionFacts";

export const attentionRuleKinds = [
  "goal-date", "idle-actions", "recurring-issue", "repeated-plan", "metric-drop", "repeated-reason", "habit-drop", "resource-gap", "review-draft", "review-due", "recent-event",
] as const;
export type AttentionRuleKind = (typeof attentionRuleKinds)[number];
export const attentionRuleLabels: Record<AttentionRuleKind, string> = {
  "goal-date": "目标日期已过",
  "idle-actions": "关联行动停滞",
  "recurring-issue": "问题反复出现",
  "repeated-plan": "行动反复改期",
  "metric-drop": "指标数值连续下降",
  "repeated-reason": "未完成原因重复出现",
  "habit-drop": "习惯记录完成比例下降",
  "resource-gap": "待补齐资源记录长期未更新",
  "review-draft": "复盘草稿周期已结束",
  "review-due": "周期复盘节点",
  "recent-event": "近期重要事件",
};
export interface AttentionRulePreference {
  enabled: boolean;
  scope: "all" | "domains";
  domainIds: readonly string[];
}

export interface AttentionSettings {
  idleWeeks: number;
  issueOccurrences: number;
  planAdjustments: number;
  metricDrops: number;
  incompleteReasons?: number;
  habitDropPoints?: number;
  resourceIdleWeeks?: number;
  resourceNodeScope?: ResourceAttentionNodeScope;
  reviewWaitDays?: number;
  reviewDraftTypes?: readonly ReviewType[];
  reviewSchedule?: ReviewSchedule;
  recentEventDays?: number;
  rules?: Partial<Record<AttentionRuleKind, AttentionRulePreference>>;
}

export const defaultAttentionSettings: AttentionSettings = {
  idleWeeks: 4,
  issueOccurrences: 3,
  planAdjustments: 3,
  metricDrops: 2,
};

export interface AttentionSource {
  id: string;
  title: string;
  date: string;
  path: "/goals" | "/issues" | "/habits" | "/resources" | "/decisions" | "/reviews" | "/settings" | "/timeline" | `/domains/${string}`;
  fragment: string;
}

export interface AttentionSignal {
  id: string;
  kind: AttentionRuleKind;
  title: string;
  summary: string;
  rule: string;
  baseline: string;
  period: string;
  domainIds: readonly string[];
  sources: readonly AttentionSource[];
  action?: { label: string; to: string };
}

export function validateAttentionSettings(value: AttentionSettings): void {
  if (!Number.isInteger(value.idleWeeks) || value.idleWeeks < 1 || value.idleWeeks > 12 ||
      !Number.isInteger(value.issueOccurrences) || value.issueOccurrences < 2 ||
      value.issueOccurrences > 10 ||
      !Number.isInteger(value.planAdjustments) || value.planAdjustments < 2 ||
      value.planAdjustments > 10 ||
      !Number.isInteger(value.metricDrops) || value.metricDrops < 2 ||
      value.metricDrops > 6) {
    throw new Error("请设置 1–12 周的行动观察期、2–10 次的问题出现／改期次数，以及 2–6 次的指标下降次数。");
  }
  if (value.incompleteReasons !== undefined && (!Number.isInteger(value.incompleteReasons) ||
      value.incompleteReasons < 2 || value.incompleteReasons > 10)) {
    throw new Error("未完成原因重复阈值请填写 2–10 项行动。");
  }
  if (value.habitDropPoints !== undefined && (!Number.isInteger(value.habitDropPoints) ||
      value.habitDropPoints < 1 || value.habitDropPoints > 100)) {
    throw new Error("习惯完成比例下降阈值请填写 1–100 个百分点。");
  }
  if (value.resourceIdleWeeks !== undefined && (!Number.isInteger(value.resourceIdleWeeks) ||
      value.resourceIdleWeeks < 1 || value.resourceIdleWeeks > 52)) {
    throw new Error("资源记录未更新观察期请填写 1–52 周。");
  }
  if (value.resourceNodeScope !== undefined && value.resourceNodeScope !== "important" &&
      value.resourceNodeScope !== "all") {
    throw new Error("请选择重要目标 / 决策或全部进行中目标 / 待决决策作为资源观察范围。");
  }
  if (value.reviewWaitDays !== undefined && (!Number.isInteger(value.reviewWaitDays) ||
      value.reviewWaitDays < 1 || value.reviewWaitDays > 30)) {
    throw new Error("复盘周期结束后的等待时间请填写 1–30 天。");
  }
  if (value.reviewDraftTypes !== undefined && (!Array.isArray(value.reviewDraftTypes) ||
      value.reviewDraftTypes.length > reviewTypes.length ||
      value.reviewDraftTypes.some(type => !reviewTypes.includes(type)) ||
      new Set(value.reviewDraftTypes).size !== value.reviewDraftTypes.length)) {
    throw new Error("请选择有效且不重复的复盘提醒周期。");
  }
  if (value.reviewSchedule !== undefined) validateReviewSchedule(value.reviewSchedule);
  if (value.recentEventDays !== undefined && (!Number.isInteger(value.recentEventDays) ||
      value.recentEventDays < 1 || value.recentEventDays > 30)) {
    throw new Error("近期重要事件观察期请填写 1–30 个日历日。");
  }
  if (value.rules?.["review-due"]?.enabled && value.reviewSchedule === undefined) {
    throw new Error("启用周期复盘节点前，请设置起始日期和周期。");
  }
  if (value.rules !== undefined) {
    if (!value.rules || typeof value.rules !== "object" || Array.isArray(value.rules) ||
        Object.keys(value.rules).some(key => !attentionRuleKinds.includes(key as AttentionRuleKind))) {
      throw new Error("提醒规则配置无效，请检查启用状态和领域范围。");
    }
    for (const rule of Object.values(value.rules)) {
      if (!rule || typeof rule !== "object" || typeof rule.enabled !== "boolean" ||
          (rule.scope !== "all" && rule.scope !== "domains") ||
          !Array.isArray(rule.domainIds) || rule.domainIds.length > 200 ||
          rule.domainIds.some(id => typeof id !== "string" || !id.trim() || id.length > 200) ||
          new Set(rule.domainIds).size !== rule.domainIds.length) {
        throw new Error("提醒规则配置无效，请检查启用状态和领域范围。");
      }
    }
  }
}

export function attentionRulePreference(settings: AttentionSettings, kind: AttentionRuleKind): AttentionRulePreference {
  return settings.rules?.[kind] ?? {
    enabled: kind !== "review-due" && kind !== "recent-event", scope: "all", domainIds: [],
  };
}

function appliesTo(settings: AttentionSettings, kind: AttentionRuleKind, domainIds: readonly string[]): boolean {
  const rule = attentionRulePreference(settings, kind);
  return rule.enabled && (rule.scope === "all" || rule.domainIds.some(id => domainIds.includes(id)));
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timestamp(value: string): number | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function findAttentionSignals(
  goals: readonly Goal[],
  actions: readonly Action[],
  issues: readonly Issue[],
  settings: AttentionSettings,
  now: Date,
  planChanges: readonly ActionPlanChange[] = [],
  metricDefinitions: readonly MetricDefinition[] = [],
  metricRecords: readonly MetricRecord[] = [],
  habits: readonly Habit[] = [],
  habitLogs: readonly HabitLog[] = [],
  resourceNeeds: readonly ResourceNeed[] = [],
  decisions: readonly Decision[] = [],
  reviews: readonly Review[] = [],
  events: readonly LifeEvent[] = [],
): AttentionSignal[] {
  validateAttentionSettings(settings);
  const currentTime = now.getTime();
  if (!Number.isFinite(currentTime)) return [];
  const today = localDate(now);
  const signals: AttentionSignal[] = [];
  signals.push(...findRecentEventSignals(events, settings, now));
  const actionsByGoal = new Map<string, Action[]>();

  for (const action of actions) {
    if (action.goalId) {
      const linked = actionsByGoal.get(action.goalId) ?? [];
      linked.push(action);
      actionsByGoal.set(action.goalId, linked);
    }
  }

  for (const goal of goals) {
    if (goal.status !== "active") continue;
    const goalSource: AttentionSource = {
      id: goal.id, title: goal.title, date: goal.createdAt,
      path: "/goals", fragment: `goal-${goal.id}`,
    };
    const domainIds = goal.domainIds;

    if (goal.targetDate && goal.targetDate < today && appliesTo(settings, "goal-date", domainIds)) {
      signals.push({
        id: `goal-date:${goal.id}`,
        kind: "goal-date",
        title: goal.title,
        summary: `目标日期 ${goal.targetDate} 已过，状态仍为进行中。`,
        rule: "仅对设有目标日期、日期早于今天且仍在进行中的目标提示。",
        baseline: `目标设定日期：${goal.targetDate}`,
        period: `${goal.targetDate} 至 ${today}`,
        domainIds,
        sources: [goalSource],
      });
      continue;
    }

    const linked = actionsByGoal.get(goal.id) ?? [];
    const open = linked.filter((action) => action.status === "open");
    if (open.length === 0) continue;

    const start = timestamp(goal.createdAt);
    if (start === null || start > currentTime) continue;
    // A newly added action restarts observation; editing a goal does not imply completed work.
    let lastActivity = start;
    for (const action of linked) {
      const created = timestamp(action.createdAt);
      if (created !== null && created <= currentTime) lastActivity = Math.max(lastActivity, created);
      if (action.status === "completed" && action.completedAt) {
        const completed = timestamp(action.completedAt);
        if (completed !== null && completed <= currentTime) {
          lastActivity = Math.max(lastActivity, completed);
        }
      }
    }
    const elapsedWeeks = Math.floor((currentTime - lastActivity) / (7 * 24 * 60 * 60 * 1000));
    if (elapsedWeeks < settings.idleWeeks) continue;

    signals.push({
      id: `idle-actions:${goal.id}`,
      kind: "idle-actions",
      title: goal.title,
      summary: `有 ${open.length} 项待完成行动，最近 ${elapsedWeeks} 周没有新行动或完成记录。`,
      rule: `有待完成的关联行动，且最近 ${settings.idleWeeks} 周没有新增行动或完成记录。`,
      baseline: `最近一次关联行动记录：${localDate(new Date(lastActivity))}`,
      period: `${localDate(new Date(lastActivity))} 至 ${today}`,
      domainIds,
      sources: [
        goalSource,
        ...open.map((action) => ({
          id: action.id, title: action.title, date: action.createdAt,
          path: "/goals" as const, fragment: `action-${action.id}`,
        })),
      ],
    });
  }

  for (const issue of issues) {
    if (issue.status === "resolved" || issue.occurrenceCount < settings.issueOccurrences ||
        issue.firstSeen > today) continue;
    signals.push({
      id: `recurring-issue:${issue.id}`,
      kind: "recurring-issue",
      title: issue.title,
      summary: `这件事已记录出现 ${issue.occurrenceCount} 次，目前尚未解决。`,
      rule: `未解决的问题累计记录 ${settings.issueOccurrences} 次或以上。`,
      baseline: "首次记录计为 1 次；只统计用户明确记录的再次出现。",
      period: `${issue.firstSeen} 至 ${today}`,
      domainIds: issue.domainIds,
      sources: [{
        id: issue.id, title: issue.title, date: issue.firstSeen,
        path: "/issues", fragment: `issue-${issue.id}`,
      }],
    });
  }

  const planStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  planStart.setDate(planStart.getDate() - 27);
  const startDate = localDate(planStart);
  const changesByAction = new Map<string, ActionPlanChange[]>();
  for (const change of planChanges) {
    const changedAt = timestamp(change.changedAt);
    if (change.reason === "initial" || changedAt === null || changedAt > currentTime ||
        localDate(new Date(changedAt)) < startDate) continue;
    const changes = changesByAction.get(change.actionId) ?? [];
    changes.push(change);
    changesByAction.set(change.actionId, changes);
  }
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const actionDomains = (action: Action) => [...new Set([
    ...action.domainIds, ...(action.goalId ? goalsById.get(action.goalId)?.domainIds ?? [] : []),
  ])];
  const reasonRule = attentionRulePreference(settings, "repeated-reason");
  if (reasonRule.enabled) {
    const candidates = actions.filter(action => {
      const updated = timestamp(action.updatedAt);
      return updated !== null && updated <= currentTime &&
        localDate(new Date(updated)) >= startDate &&
        appliesTo(settings, "repeated-reason", actionDomains(action));
    });
    for (const group of groupIncompleteReasons(candidates)) {
      if (group.actions.length < (settings.incompleteReasons ?? 3)) continue;
      signals.push({
        id: `repeated-reason:${group.actions.map(action => action.id).sort().join(":")}`,
        kind: "repeated-reason",
        title: "相同未完成原因",
        summary: `${group.actions.length} 项未完成行动填写了相同原因：${group.reason}`,
        rule: `近 28 天更新的未完成行动中，至少 ${settings.incompleteReasons ?? 3} 项填写完全相同的原因原文。`,
        baseline: "每项行动只计一次；使用当前反馈，不推断原因类别或历史发生次数。更新日期不是原因发生日期。",
        period: `${startDate} 至 ${today}`,
        domainIds: [...new Set(group.actions.flatMap(actionDomains))],
        sources: group.actions.map(action => ({
          id: action.id, title: action.title, date: action.updatedAt,
          path: "/goals", fragment: `action-${action.id}`,
        })),
      });
    }
  }
  for (const action of actions) {
    const changes = changesByAction.get(action.id) ?? [];
    if (changes.length < settings.planAdjustments) continue;
    const goalDomainIds = action.goalId ? goalsById.get(action.goalId)?.domainIds ?? [] : [];
    signals.push({
      id: `repeated-plan:${action.id}`,
      kind: "repeated-plan",
      title: action.title,
      summary: `过去 28 天记录了 ${changes.length} 次安排日期调整。`,
      rule: `同一行动在过去 28 天内记录 ${settings.planAdjustments} 次或以上改期（不含首次安排）。`,
      baseline: "仅统计已记录的调整，不推断调整原因或计划被打断。",
      period: `${startDate} 至 ${today}`,
      domainIds: [...new Set([...action.domainIds, ...goalDomainIds])],
      sources: changes.map((change) => ({
        id: `${action.id}:${change.id}`,
        title: `${change.beforeDate ?? "未安排"} → ${change.afterDate ?? "取消安排"} · ${planReasonLabels[change.reason]}`,
        date: change.changedAt,
        path: "/goals",
        fragment: `action-${action.id}`,
      })),
    });
  }

  const recent = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  recent.setDate(recent.getDate() - 6);
  const recentDate = localDate(recent);
  for (const definition of metricDefinitions) {
    if (definition.archived || definition.domainIds.length === 0) continue;
    const ordered = metricRecords.filter((record) =>
      record.metricId === definition.id && Number.isFinite(record.value) &&
      record.recordedOn >= startDate && record.recordedOn <= today)
      .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));
    if (!ordered.length || ordered[ordered.length - 1].recordedOn < recentDate) continue;

    const chain = [ordered[ordered.length - 1]];
    for (let index = ordered.length - 2; index >= 0; index--) {
      if (ordered[index].value <= chain[0].value) break;
      chain.unshift(ordered[index]);
    }
    const drops = chain.length - 1;
    if (drops < settings.metricDrops) continue;
    const first = chain[0];
    const last = chain[chain.length - 1];
    signals.push({
      id: `metric-drop:${definition.id}`,
      kind: "metric-drop",
      title: definition.name,
      summary: `近 28 天的记录连续下降 ${drops} 次：${first.value} ${definition.unit} → ${last.value} ${definition.unit}。`,
      rule: `同一指标近 28 天内连续 ${settings.metricDrops} 次或以上数值下降，末次记录距今不超过 7 天；不判断数值高低是否有利。`,
      baseline: `${first.recordedOn}：${first.value} ${definition.unit}；未记录的日期不补值。`,
      period: `${first.recordedOn} 至 ${last.recordedOn}`,
      domainIds: definition.domainIds,
      sources: chain.map((record) => ({
        id: record.id,
        title: `${record.recordedOn} · ${record.value} ${definition.unit}`,
        date: record.recordedOn,
        path: `/domains/${encodeURIComponent(definition.domainIds[0])}`,
        fragment: `metric-record-${record.id}`,
      })),
    });
  }

  signals.push(...findHabitDeclineSignals(habits, habitLogs, attentionRulePreference(settings, "habit-drop"),
    settings.habitDropPoints ?? 20, now));
  signals.push(...findResourceGapSignals(resourceNeeds, goals, decisions,
    attentionRulePreference(settings, "resource-gap"), settings.resourceIdleWeeks ?? 4,
    settings.resourceNodeScope ?? "important", now));
  const scheduledReviews = findScheduledReviewSignals(reviews, attentionRulePreference(settings, "review-due"),
    settings.reviewSchedule, now);
  const representedDrafts = new Set(scheduledReviews.flatMap(signal =>
    signal.sources.filter(source => source.path === "/reviews").map(source => `review-draft:${source.id}`)));
  signals.push(...findReviewDraftSignals(reviews, attentionRulePreference(settings, "review-draft"),
    settings.reviewDraftTypes ?? defaultReviewAttentionTypes, settings.reviewWaitDays ?? 1, now)
    .filter(signal => !representedDrafts.has(signal.id)), ...scheduledReviews);
  return signals.filter(signal => appliesTo(settings, signal.kind, signal.domainIds));
}
