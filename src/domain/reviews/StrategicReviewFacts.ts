import type { ReviewPeriod } from "./ReviewStructure";
import { goalStatusLabels, type Goal } from "../planning/Goal";
import { goalHorizonLabels } from "../planning/GoalHorizon";
import type { LifeEvent, Skill } from "../records/LifeRecords";
import type { Decision } from "../decisions/Decision";
import type { LifeNavigation } from "../life/LifeNavigation";
import { resourceKindLabels, type ResourceNeed } from "../resources/Resources";

export interface StrategicReviewFactData {
  events?: readonly LifeEvent[];
  skills?: readonly Skill[];
  decisions?: readonly Decision[];
  navigation?: readonly LifeNavigation[];
  needs?: readonly ResourceNeed[];
}

export function appendStrategicReviewFacts(period: ReviewPeriod,
  data: StrategicReviewFactData & { goals: readonly Goal[]; observedOn: string },
  domainIds: readonly string[], add: (key: string, line: string) => void): void {
  if (period.type !== "quarterly" && period.type !== "annual") return;
  const observed = (date: string) => date.slice(0, 10) <= data.observedOn;
  const available = (date: string) => observed(date) && date.slice(0, 10) <= period.end;
  const inside = (date: string) => available(date) && date.slice(0, 10) >= period.start;
  const scoped = (ids: readonly string[]) => !domainIds.length || ids.some(id => domainIds.includes(id));
  const byGoal = new Map(data.goals.map(goal => [goal.id, goal]));
  const linkedScope = (record: { domainIds: readonly string[]; goalId: string | null }) =>
    scoped([...record.domainIds, ...(record.goalId ? byGoal.get(record.goalId)?.domainIds ?? [] : [])]);
  const goals = data.goals.filter(goal => available(goal.createdAt) && scoped(goal.domainIds));
  const decisions = (data.decisions ?? []).filter(decision => observed(decision.createdAt) && available(decision.decidedOn) && linkedScope(decision));
  const snapshot = "当前快照（" + data.observedOn + "）";
  const referencedDirections = new Set([
    ...goals.flatMap(goal => goal.directionId ? [goal.directionId] : []),
    ...decisions.flatMap(decision => decision.navigationIds ?? []),
  ]);
  for (const direction of [...data.navigation ?? []].sort((a, b) => a.id.localeCompare(b.id))) {
    if (direction.kind !== "vision" || !available(direction.createdAt) ||
      (domainIds.length ? !referencedDirections.has(direction.id) : Boolean(direction.archivedAt) && !referencedDirections.has(direction.id))) continue;
    add(period.type === "quarterly" ? "directionAdjustment" : "longTermDirection",
      snapshot + "「" + direction.title + "」" + (direction.archivedAt ? "（已归档引用）" : "") +
      (direction.description ? "：" + direction.description : "") + "；方向调整待确认");
  }
  if (period.type === "quarterly") {
    for (const goal of [...goals].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!["candidate", "active", "paused"].includes(goal.status) ||
        !goal.horizon || !["quarter", "stage", "month"].includes(goal.horizon) ||
        !(goal.targetDate ? goal.targetDate <= period.end : inside(goal.createdAt) || inside(goal.updatedAt))) continue;
      add("goalRollover", snapshot + "「" + goal.title + "」：" + goalHorizonLabels[goal.horizon] +
        "；" + goalStatusLabels[goal.status] + "；计划日期 " + (goal.targetDate ?? "未设置") + "；是否滚动待确认");
    }
    for (const need of [...data.needs ?? []].sort((a, b) => a.id.localeCompare(b.id))) {
      if (need.met || !available(need.createdAt)) continue;
      const owners = [
        ...goals.filter(goal => goal.id === need.goalId),
        ...decisions.filter(decision => decision.id === need.decisionId || decision.resourceNeedIds?.includes(need.id)),
      ];
      if (!owners.length) continue;
      add("resourceGaps", snapshot + "「" + owners.map(owner => owner.title).join("、") + "」：" +
        resourceKindLabels[need.kind] + "；" + need.description + "（当前未满足，非周期资源余额）");
    }
  }
  if (period.type === "annual") {
    for (const event of [...data.events ?? []].sort((a, b) => a.happenedOn.localeCompare(b.happenedOn) || a.id.localeCompare(b.id))) {
      if (!observed(event.createdAt) || !inside(event.happenedOn) || !linkedScope(event)) continue;
      add("importantEvents", event.happenedOn + "「" + event.title + "」" + (event.archived ? "（已归档）" : "") +
        (event.description ? "；当前记录：" + event.description : ""));
    }
    for (const decision of [...decisions].sort((a, b) => a.decidedOn.localeCompare(b.decidedOn) || a.id.localeCompare(b.id))) {
      if (decision.importance !== "major" || !inside(decision.decidedOn)) continue;
      add("majorDecisions", decision.decidedOn + "「" + decision.title + "」：" +
        (decision.status === "decided" ? "已确定；当前选择：" + decision.choice : "考虑中，尚未确定选择") +
        (decision.outcome ? "；当前结果：" + decision.outcome : "") +
        (decision.reflection ? "；当前复盘：" + decision.reflection : ""));
    }
    for (const skill of [...data.skills ?? []].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!observed(skill.createdAt) || !(inside(skill.createdAt) || inside(skill.updatedAt)) || !linkedScope(skill)) continue;
      add("capabilityGrowth", snapshot + "「" + skill.name + "」" + (skill.archived ? "（已归档）" : "") +
        "；当前水平 " + skill.currentLevel + "；目标水平 " + skill.targetLevel + "（非年度增长量）" +
        (skill.learningPath ? "；学习路径：" + skill.learningPath : "") +
        (skill.practice ? "；练习与成果：" + skill.practice : "") +
        (skill.reflection ? "；复盘：" + skill.reflection : ""));
    }
  }
}
