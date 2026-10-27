import type { Habit, HabitLog } from "../habits/Habit";
import type { Action } from "../planning/Action";
import { isPlainDate, type Goal } from "../planning/Goal";
import { calculateGoalProgress } from "../progress/GoalProgress";
import type { GoalProgressItem } from "../progress/GoalProgressItem";
import type { HabitGoalProgressSetting } from "../progress/HabitGoalProgress";

export interface ExportGoalProgress {
  percent: number | null;
  basis: string;
  calculatedOn: string;
  habitSettings?: readonly (HabitGoalProgressSetting & { title: string })[];
  dependencies: readonly {
    type: "goal" | "action" | "progress-item" | "habit" | "habit-log";
    id: string;
  }[];
}

export function calculateExportGoalProgress(
  goals: readonly Goal[],
  actions: readonly Action[],
  items: readonly GoalProgressItem[],
  calculatedOn: string,
  habitContext?: { habits: readonly Habit[]; logs: readonly HabitLog[] },
): ReadonlyMap<string, ExportGoalProgress> {
  const progress = calculateGoalProgress(goals, actions, items,
    habitContext ? { ...habitContext, today: calculatedOn } : undefined);
  const byParent = new Map<string, Goal[]>();
  const byGoalAction = new Map<string, Action[]>();
  const byGoalItem = new Map<string, GoalProgressItem[]>();
  for (const goal of goals) {
    if (goal.parentId) byParent.set(goal.parentId, [...(byParent.get(goal.parentId) ?? []), goal]);
  }
  for (const action of actions) {
    if (action.goalId) byGoalAction.set(action.goalId, [...(byGoalAction.get(action.goalId) ?? []), action]);
  }
  for (const item of items) byGoalItem.set(item.goalId, [...(byGoalItem.get(item.goalId) ?? []), item]);
  const habits = new Map(habitContext?.habits.map(habit => [habit.id, habit]) ?? []);
  const result = new Map<string, ExportGoalProgress>();
  const visiting = new Set<string>();
  const visit = (goal: Goal): ExportGoalProgress => {
    const cached = result.get(goal.id);
    if (cached) return cached;
    const dependencies: ExportGoalProgress["dependencies"][number][] = [];
    let basis: string;
    if (goal.progressMode === "exploration") {
      basis = "探索型目标未启用百分比，不以零进度代替未知。";
    } else if (goal.status === "completed" || (goal.status === "archived" && goal.completedAt)) {
      basis = "依据当前已完成状态，不代表历史日期的进度。";
    } else if (goal.habitProgress?.length) {
      basis = "按目标已保存的习惯周期、频率与权重计算，仅纳入有实际记录的完整周。";
      for (const setting of goal.habitProgress) {
        dependencies.push({ type: "habit", id: setting.habitId });
        const habit = habits.get(setting.habitId);
        if (!habit) continue;
        const earliest = setting.startOn > habit.startOn ? setting.startOn : habit.startOn;
        const latest = setting.endOn < calculatedOn ? setting.endOn : calculatedOn;
        for (const log of habitContext?.logs ?? []) {
          if (log.habitId !== habit.id || !isPlainDate(log.recordedOn) ||
              log.recordedOn < earliest || log.recordedOn > latest) continue;
          const monday = new Date(`${log.recordedOn}T00:00:00Z`);
          monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
          const start = monday.toISOString().slice(0, 10);
          const end = new Date(monday.getTime() + 6 * 86400000).toISOString().slice(0, 10);
          if (start >= earliest && end <= latest && end < calculatedOn) {
            dependencies.push({ type: "habit-log", id: log.id });
          }
        }
      }
    } else if (byGoalItem.get(goal.id)?.length) {
      basis = "按当前进度项的目标值、当前值与权重计算，单项完成比例最多计为 100%。";
      dependencies.push(...byGoalItem.get(goal.id)!.map(item => ({ type: "progress-item" as const, id: item.id })));
    } else {
      basis = "按下级目标和直接行动的当前进度及贡献权重汇总；未知下级进度不补零。";
      // Follow the engine's precedence; completed/exploration/item goals do not depend on child facts.
      if (!visiting.has(goal.id)) {
        visiting.add(goal.id);
        for (const child of byParent.get(goal.id) ?? []) {
          dependencies.push({ type: "goal", id: child.id }, ...visit(child).dependencies);
        }
        visiting.delete(goal.id);
      }
      dependencies.push(...(byGoalAction.get(goal.id) ?? [])
        .map(action => ({ type: "action" as const, id: action.id })));
    }
    const snapshot: ExportGoalProgress = {
      percent: progress.get(goal.id)?.percent ?? null, basis, calculatedOn,
      dependencies: [...new Map(dependencies.map(ref => [`${ref.type}:${ref.id}`, ref])).values()],
      ...(goal.habitProgress?.length && goal.progressMode !== "exploration" &&
        goal.status !== "completed" && !(goal.status === "archived" && goal.completedAt)
        ? { habitSettings: goal.habitProgress.map(setting => ({
          ...setting, title: habits.get(setting.habitId)?.title ?? "",
        })) } : {}),
    };
    result.set(goal.id, snapshot);
    return snapshot;
  };
  goals.forEach(visit);
  return result;
}

export function exportGoalProgressFields(snapshot: ExportGoalProgress, allowed: ReadonlySet<string>) {
  const complete = snapshot.dependencies.every(ref => allowed.has(`${ref.type}:${ref.id}`));
  return [
    { label: "当前进度", value: !complete ? "本次未纳入完整计算记录，未导出当前进度。"
      : snapshot.percent === null ? "未形成可计算百分比" : `${snapshot.percent}%` },
    { label: "进度依据", value: complete ? snapshot.basis : "按本次隐私、日期、对象类型和范围筛选，不以局部记录代替完整进度。" },
    { label: "进度计算日期", value: snapshot.calculatedOn },
    ...(complete && snapshot.habitSettings?.length ? [{
      label: "习惯进度配置",
      value: snapshot.habitSettings.map(setting =>
        `${setting.title}：${setting.startOn} 至 ${setting.endOn}；每周期望 ${setting.weeklyTarget} 次；权重 ${setting.weight}`).join("\n"),
    }] : []),
  ];
}
