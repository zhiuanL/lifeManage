import type { Decision } from "../decisions/Decision";
import { isPlainDate, type Goal } from "../planning/Goal";
import { resourceKindLabels, resourceKinds, type ResourceNeed } from "../resources/Resources";
import type { AttentionRulePreference, AttentionSignal, AttentionSource } from "./Attention";

export type ResourceAttentionNodeScope = "important" | "all";

function timestamp(value: string): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) ||
      !isPlainDate(value.slice(0, 10))) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function findResourceGapSignals(
  needs: readonly ResourceNeed[],
  goals: readonly Goal[],
  decisions: readonly Decision[],
  preference: AttentionRulePreference,
  idleWeeks: number,
  nodeScope: ResourceAttentionNodeScope,
  now: Date,
): AttentionSignal[] {
  if (!preference.enabled) return [];
  const current = now.getTime();
  if (!Number.isFinite(current)) return [];
  const week = 7 * 24 * 60 * 60 * 1000;
  const owners = [
    ...goals.filter(goal => goal.status === "active" && (nodeScope === "all" || goal.priority === "high"))
      .map(goal => ({ type: "goal" as const, item: goal, path: "/goals" as const })),
    ...decisions.filter(decision => decision.status === "considering" &&
      (nodeScope === "all" || decision.importance === "major"))
      .map(decision => ({ type: "decision" as const, item: decision, path: "/decisions" as const })),
  ];
  const ownerMap = new Map(owners.map(owner => [`${owner.type}:${owner.item.id}`, owner]));
  const grouped = new Map<string, { need: ResourceNeed; updated: number }[]>();

  for (const need of needs) {
    if (need.met !== false || Boolean(need.goalId) === Boolean(need.decisionId) ||
        !resourceKinds.includes(need.kind)) continue;
    const key = need.goalId ? `goal:${need.goalId}` : `decision:${need.decisionId}`;
    const owner = ownerMap.get(key);
    if (!owner || (preference.scope === "domains" &&
        !preference.domainIds.some(id => owner.item.domainIds.includes(id)))) continue;
    const created = timestamp(need.createdAt);
    const updated = timestamp(need.updatedAt);
    const ownerCreated = timestamp(owner.item.createdAt);
    if (created === null || updated === null || ownerCreated === null ||
        ownerCreated > created || created > updated || updated > current ||
        current - updated < idleWeeks * week) continue;
    const records = grouped.get(key) ?? [];
    records.push({ need, updated });
    grouped.set(key, records);
  }

  // Only current status and update age are known; they cannot establish a continuous shortage.
  return [...grouped].map(([key, records]) => {
    const owner = ownerMap.get(key)!;
    records.sort((a, b) => a.updated - b.updated || (a.need.id < b.need.id ? -1 : a.need.id > b.need.id ? 1 : 0));
    const ownerSource: AttentionSource = {
      id: owner.item.id, title: owner.item.title, date: owner.item.createdAt,
      path: owner.path, fragment: `${owner.type}-${owner.item.id}`,
    };
    const selection = nodeScope === "important"
      ? "进行中的高优先级目标或待决重大决策"
      : "进行中的目标或待决决策";
    return {
      id: `resource-gap:${key}`, kind: "resource-gap",
      title: owner.item.title,
      summary: `${records.length} 项资源需求当前标记为待补齐，记录至少 ${idleWeeks} 周未更新。`,
      rule: `仅观察${selection}；资源需求当前为待补齐，且距最后更新已满 ${idleWeeks} 周，按所属目标或决策合并提示。`,
      baseline: `只依据当前状态和最后更新时间，不代表持续不足时长，也不判断实际容量、余额或库存。` +
        `领域范围只取资源需求所属对象的显式领域，不从引用的人物、能力或其他资源推导。`,
      period: `${localDate(new Date(records[0].updated))} 至 ${localDate(now)}`,
      domainIds: owner.item.domainIds,
      sources: [ownerSource, ...records.map(({ need }) => ({
        id: need.id, title: `${resourceKindLabels[need.kind]} · ${need.description}（当前待补齐）`,
        date: need.updatedAt, path: "/resources" as const, fragment: `resource-${need.id}`,
      }))],
    } satisfies AttentionSignal;
  });
}
