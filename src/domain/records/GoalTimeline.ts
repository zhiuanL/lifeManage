import { goalStatuses, goalStatusLabels, isPlainDate, type Goal } from "../planning/Goal";
import { progressItemKinds, progressItemLabels, type GoalProgressItem } from "../progress/GoalProgressItem";

export interface GoalVersionFact {
  id: number;
  objectId: string;
  changedAt: string;
  snapshot: Record<string, unknown>;
}

export interface GoalTimelineEntry {
  id: string;
  goalId: string;
  changedAt: string;
  label: "目标调整" | "阶段成果";
  title: string;
  detail: string;
  domainIds: readonly string[];
}

const fieldLabels = {
  title: "名称", description: "说明", status: "状态", status_reason: "状态原因",
  target_date: "目标日期", parent_id: "上级目标", priority: "优先级",
  horizon: "规划周期", direction_id: "长期方向", progress_mode: "进度方式",
  progress_weight: "贡献权重", archived_at: "归档状态",
  domain_ids: "关联领域", relations: "目标关系", habit_progress: "习惯进度设置",
  progress_items: "进度项",
} as const;

function owns(snapshot: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(snapshot, key);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function domainIds(snapshot: Record<string, unknown>): string[] | null {
  if (!owns(snapshot, "domain_ids") && !owns(snapshot, "domain_id")) return null;
  const ids = snapshot.domain_ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id))) {
    throw new Error("目标历史领域关联无效。");
  }
  const primary = snapshot.domain_id;
  if (primary != null && (typeof primary !== "string" || !primary)) {
    throw new Error("目标历史领域关联无效。");
  }
  return [...new Set([...(typeof primary === "string" ? [primary] : []),
    ...(Array.isArray(ids) ? ids as string[] : [])])];
}

function progressItems(value: unknown): Record<string, unknown>[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw new Error("目标历史进度项无效。");
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id ||
        seen.has(item.id) || typeof item.title !== "string" || !item.title.trim() ||
        !progressItemKinds.includes(item.kind) || !Number.isFinite(item.target_value) ||
        item.target_value <= 0 || !Number.isFinite(item.current_value) || item.current_value < 0) {
      throw new Error("目标历史进度项无效。");
    }
    seen.add(item.id);
    return item as Record<string, unknown>;
  });
}

function currentSnapshot(goal: Goal, items: readonly GoalProgressItem[]): Record<string, unknown> {
  return {
    title: goal.title, description: goal.description, status: goal.status,
    status_reason: goal.statusReason ?? null, target_date: goal.targetDate,
    parent_id: goal.parentId, priority: goal.priority ?? "medium",
    horizon: goal.horizon ?? null, direction_id: goal.directionId ?? null,
    progress_mode: goal.progressMode ?? "automatic", progress_weight: goal.progressWeight ?? 1,
    archived_at: goal.archivedAt ?? null, domain_ids: [...goal.domainIds],
    relations: (goal.relations ?? []).map(item => ({
      target_goal_id: item.targetGoalId, relation_type: item.type,
    })),
    habit_progress: (goal.habitProgress ?? []).map((item, index) => ({
      habit_id: item.habitId, start_on: item.startOn, end_on: item.endOn,
      weekly_target: item.weeklyTarget, weight: item.weight, sort_order: index,
    })),
    progress_items: items.map(item => ({
      id: item.id, kind: item.kind, title: item.title,
      target_value: item.targetValue, current_value: item.currentValue, weight: item.weight,
    })),
  };
}

export function buildGoalTimeline(goals: readonly Goal[], items: readonly GoalProgressItem[],
  versions: readonly GoalVersionFact[]): GoalTimelineEntry[] {
  const grouped = new Map<string, GoalVersionFact[]>();
  const itemsByGoal = new Map<string, GoalProgressItem[]>();
  for (const item of items) {
    const list = itemsByGoal.get(item.goalId) ?? [];
    list.push(item); itemsByGoal.set(item.goalId, list);
  }
  const seen = new Set<number>();
  for (const version of versions) {
    if (!Number.isSafeInteger(version.id) || version.id <= 0 || seen.has(version.id) ||
        !version.objectId || !validTimestamp(version.changedAt) ||
        !version.snapshot || typeof version.snapshot !== "object" || Array.isArray(version.snapshot)) {
      throw new Error("目标历史内容无效。");
    }
    seen.add(version.id);
    const list = grouped.get(version.objectId) ?? [];
    list.push(version); grouped.set(version.objectId, list);
  }
  const entries: GoalTimelineEntry[] = [];
  for (const goal of goals) {
    const history = (grouped.get(goal.id) ?? []).sort((a, b) => a.id - b.id);
    const current = currentSnapshot(goal, itemsByGoal.get(goal.id) ?? []);
    for (let index = 0; index < history.length; index++) {
      const version = history[index];
      // A before-change snapshot is paired with the next snapshot, or the current persisted record.
      const before = version.snapshot;
      const after = history[index + 1]?.snapshot ?? current;
      if (index === history.length - 1 &&
          (!validTimestamp(goal.updatedAt) || Date.parse(goal.updatedAt) < Date.parse(version.changedAt))) {
        throw new Error("目标记录与历史读取不一致，请重新读取。");
      }
      for (const snapshot of [before, after]) {
        if (typeof snapshot.title !== "string" || !snapshot.title.trim() ||
            !goalStatuses.includes(snapshot.status as Goal["status"])) {
          throw new Error("目标历史基本内容无效。");
        }
      }
      const beforeIds = domainIds(before);
      const afterIds = domainIds(after);
      const priorItems = progressItems(before.progress_items);
      const nextItems = progressItems(after.progress_items);
      const scope = [...new Set([...(beforeIds ?? []), ...(afterIds ?? [])])];
      const changed = Object.keys(fieldLabels).filter(key => {
        if (key === "domain_ids") return beforeIds !== null && afterIds !== null &&
          canonical(beforeIds) !== canonical(afterIds);
        if (key === "progress_items") {
          if (priorItems === null || nextItems === null) return false;
          const weightsKnown = [...priorItems, ...nextItems].every(item => owns(item, "weight"));
          const comparable = (values: Record<string, unknown>[]) => values.map(item => ({
            id: item.id, kind: item.kind, title: item.title,
            target_value: item.target_value, current_value: item.current_value,
            ...(weightsKnown ? { weight: item.weight } : {}),
          }));
          return canonical(comparable(priorItems)) !== canonical(comparable(nextItems));
        }
        return owns(before, key) && owns(after, key) &&
          canonical(before[key]) !== canonical(after[key]);
      }) as (keyof typeof fieldLabels)[];
      const base = { goalId: goal.id, changedAt: version.changedAt,
        title: String(after.title), domainIds: scope };
      if (changed.length) {
        const status = changed.includes("status") ? `；${goalStatusLabels[before.status as Goal["status"]]}变为${
          goalStatusLabels[after.status as Goal["status"]]}` : "";
        entries.push({ ...base, id: `goal-change-${version.id}`, label: "目标调整",
          detail: `调整${changed.map(key => fieldLabels[key]).join("、")}${status}` });
      }
      if (priorItems === null || nextItems === null) continue;
      const priorById = new Map(priorItems.map(item => [item.id, item]));
      for (const item of nextItems) {
        const prior = priorById.get(item.id);
        // New items and changed thresholds are not evidence that a recorded result was achieved.
        if (!prior || prior.kind !== item.kind || prior.target_value !== item.target_value ||
            Number(prior.current_value) >= Number(prior.target_value) ||
            Number(item.current_value) < Number(item.target_value)) continue;
        entries.push({ ...base, id: `goal-result-${version.id}-${String(item.id)}`, label: "阶段成果",
          detail: `${progressItemLabels[item.kind as GoalProgressItem["kind"]]}：${String(item.title)}（${
            Number(item.current_value)} / ${Number(item.target_value)}）` });
      }
    }
  }
  return entries.sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt) || a.id.localeCompare(b.id));
}

function validTimestamp(value: string): boolean {
  return typeof value === "string" && isPlainDate(value.slice(0, 10)) &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) &&
    Number.isFinite(Date.parse(value));
}
