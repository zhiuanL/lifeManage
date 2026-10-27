import type { LifeDomain } from "../life/LifeDomain";
import type { LifeNavigation } from "../life/LifeNavigation";
import type { Action } from "../planning/Action";
import { isPlainDate, type Goal } from "../planning/Goal";
import { goalRelationTypes } from "../planning/GoalRelation";
import type { Habit, HabitLog } from "../habits/Habit";
import { validateProgressItems, type GoalProgressItem } from "../progress/GoalProgressItem";
import { normalizeHabitGoalSettings } from "../progress/HabitGoalProgress";
import { normalizeProgressWeight } from "../progress/ProgressWeight";

export const qualityCategoryLabels = {
  reference: "失效关联", hierarchy: "目标层级", date: "日期记录", value: "字段与设置",
} as const;
export type QualityCategory = keyof typeof qualityCategoryLabels;
export interface QualityFinding {
  key: string;
  category: QualityCategory;
  sourceTitle: string;
  sourceType: string;
  message: string;
  sourcePath: string | null;
}
export interface DataQualityFacts {
  domains: readonly LifeDomain[];
  navigation: readonly LifeNavigation[];
  goals: readonly Goal[];
  actions: readonly Action[];
  items: readonly GoalProgressItem[];
  habits: readonly Habit[];
  logs: readonly HabitLog[];
}
export interface DataQualityReport {
  checkedAt: string;
  counts: readonly { label: string; count: number }[];
  findings: readonly QualityFinding[];
}

export function inspectDataQuality(facts: DataQualityFacts, today: string): QualityFinding[] {
  if (!isPlainDate(today)) throw new Error("检查日期无效。");
  const findings: QualityFinding[] = [];
  const domains = new Set(facts.domains.map(row => row.id));
  const goals = new Map(facts.goals.map(row => [row.id, row]));
  const habits = new Map(facts.habits.map(row => [row.id, row]));
  const navigation = new Map(facts.navigation.map(row => [row.id, row]));
  const add = (category: QualityCategory, id: string, code: string, sourceType: string,
    sourceTitle: string, sourcePath: string | null, message: string) => {
    findings.push({ key: JSON.stringify([sourceType, id, code]), category,
      sourceType, sourceTitle, sourcePath, message });
  };
  const checkDomains = (ids: readonly string[], id: string, type: string, title: string, path: string) => {
    if (ids.some(domainId => !domains.has(domainId))) {
      add("reference", id, "domain", type, title, path, "已保存的领域关联指向不存在的领域。");
    }
  };
  const checkDate = (value: string | null, id: string, code: string,
    type: string, title: string, path: string) => {
    if (value !== null && !isPlainDate(value)) {
      add("date", id, code, type, title, path, "已保存的日期不是有效的年月日。");
    }
  };
  const checkWeight = (value: number | undefined, id: string, type: string, title: string, path: string) => {
    try { normalizeProgressWeight(value); }
    catch { add("value", id, "weight", type, title, path, "贡献权重须大于 0 且不超过 100。"); }
  };
  for (const goal of facts.goals) {
    const path = "/goals/" + encodeURIComponent(goal.id);
    checkDomains(goal.domainIds, goal.id, "目标", goal.title, path);
    checkDate(goal.targetDate, goal.id, "target-date", "目标", goal.title, path);
    checkWeight(goal.progressWeight, goal.id, "目标", goal.title, path);
    if (goal.parentId !== null && !goals.has(goal.parentId)) {
      add("reference", goal.id, "parent", "目标", goal.title, path, "已保存的上级目标不存在。");
    }
    if (goal.directionId != null && navigation.get(goal.directionId)?.kind !== "vision") {
      add("reference", goal.id, "direction", "目标", goal.title, path, "长期方向不存在或不属于愿景与长期方向。");
    }
    if ((goal.relations ?? []).some(relation => relation.targetGoalId === goal.id ||
      !goals.has(relation.targetGoalId) || !goalRelationTypes.includes(relation.type))) {
      add("reference", goal.id, "relations", "目标", goal.title, path, "目标关系包含不存在的目标、自身关联或无效类型。");
    }
    if (goal.habitProgress != null) {
      if (goal.habitProgress.some(setting => !habits.has(setting.habitId))) {
        add("reference", goal.id, "habits", "目标", goal.title, path, "习惯型进度引用的习惯不存在。");
      }
      try {
        normalizeHabitGoalSettings(goal.habitProgress);
        if (goal.progressMode !== "automatic") throw new Error("mode");
      } catch {
        add("value", goal.id, "habit-settings", "目标", goal.title, path,
          "习惯型进度的周期、频率、权重或进度方式不符合保存规则。");
      }
    }
  }
  // Walk each parent chain once; report cycle members, not the valid descendants leading into it.
  const visited = new Set<string>();
  const cyclic = new Set<string>();
  for (const goal of facts.goals) {
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let id: string | null = goal.id;
    while (id !== null && goals.has(id) && !visited.has(id)) {
      const position = positions.get(id);
      if (position !== undefined) {
        for (const member of chain.slice(position)) cyclic.add(member);
        break;
      }
      positions.set(id, chain.length);
      chain.push(id);
      id = goals.get(id)!.parentId;
    }
    for (const member of chain) visited.add(member);
  }
  for (const goal of facts.goals) {
    if (cyclic.has(goal.id)) add("hierarchy", goal.id, "cycle", "目标", goal.title,
      "/goals/" + encodeURIComponent(goal.id), "此目标的上级关联形成循环，无法建立有效层级。");
  }
  for (const action of facts.actions) {
    const path = "/goals?actionStatus=all#action-" + encodeURIComponent(action.id);
    checkDomains(action.domainIds, action.id, "行动", action.title, path);
    checkDate(action.scheduledFor, action.id, "scheduled", "行动", action.title, path);
    checkWeight(action.progressWeight, action.id, "行动", action.title, path);
    if (action.goalId !== null && !goals.has(action.goalId)) {
      add("reference", action.id, "goal", "行动", action.title, path, "已保存的关联目标不存在。");
    }
  }
  for (const item of facts.items) {
    const path = goals.has(item.goalId) ? "/goals/" + encodeURIComponent(item.goalId) : null;
    if (path === null) add("reference", item.id, "owner", "目标进度项", item.title, null,
      "进度项的所属目标不存在。请保留备份，不要直接删除记录。");
    try { validateProgressItems([item]); }
    catch { add("value", item.id, "values", "目标进度项", item.title, path,
      "进度项的类型、名称、目标值、当前值或权重不符合保存规则。"); }
  }
  for (const habit of facts.habits) {
    const path = "/habits#habit-" + encodeURIComponent(habit.id);
    checkDomains(habit.domainIds, habit.id, "习惯", habit.title, path);
    if (!isPlainDate(habit.startOn) || habit.startOn > today) {
      add("date", habit.id, "start", "习惯", habit.title, path, "习惯开始日无效或晚于检查日期。");
    }
    if (!Number.isInteger(habit.weeklyTarget) || habit.weeklyTarget < 1 || habit.weeklyTarget > 7) {
      add("value", habit.id, "frequency", "习惯", habit.title, path, "每周期望次数须为 1 至 7 的整数。");
    }
  }
  const seenLogDates = new Set<string>();
  for (const log of facts.logs) {
    const habit = habits.get(log.habitId);
    const path = habit ? "/habits#habit-log-" + encodeURIComponent(log.id) : null;
    const title = habit?.title ?? "打卡记录";
    if (!habit) add("reference", log.id, "owner", "习惯打卡", title, null,
      "打卡的所属习惯不存在。请保留备份，不要直接删除记录。");
    if (!isPlainDate(log.recordedOn) || log.recordedOn > today ||
      (habit && isPlainDate(habit.startOn) && log.recordedOn < habit.startOn)) {
      add("date", log.id, "recorded", "习惯打卡", title, path, "打卡日期无效、晚于检查日期或早于习惯开始日。");
    }
    const key = JSON.stringify([log.habitId, log.recordedOn]);
    if (seenLogDates.has(key)) add("value", log.id, "duplicate-date", "习惯打卡", title, path,
      "同一习惯同一天存在重复打卡记录。");
    seenLogDates.add(key);
  }
  return findings;
}
