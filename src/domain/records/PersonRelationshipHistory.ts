import { isDomainHistoryTimestamp } from "../life/DomainHistory";

export interface PersonRelationshipSnapshot {
  name: string;
  relationshipType: string;
  state: string;
  domainIds: readonly string[];
}
export interface PersonRelationshipChange {
  id: number;
  personId: string;
  changedAt: string;
  before: PersonRelationshipSnapshot;
  after: PersonRelationshipSnapshot;
}
export interface PersonRelationshipEntry {
  id: string;
  personId: string;
  changedAt: string;
  title: string;
  detail: string;
  domainIds: readonly string[];
  change: PersonRelationshipChange;
}

function invalid(): never { throw new Error("人物关系历史包含无效记录。"); }

export function parsePersonRelationshipSnapshot(value: unknown): PersonRelationshipSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  const fields = ["name", "relationshipType", "state", "domainIds"];
  if (Object.keys(row).length !== fields.length ||
    fields.some(field => !Object.prototype.hasOwnProperty.call(row, field)) ||
    typeof row.name !== "string" || !row.name.trim() || row.name.length > 80 ||
    typeof row.relationshipType !== "string" || row.relationshipType.length > 80 ||
    typeof row.state !== "string" || row.state.length > 200 ||
    !Array.isArray(row.domainIds) || row.domainIds.some(id => typeof id !== "string" || !id.trim()) ||
    new Set(row.domainIds).size !== row.domainIds.length) return invalid();
  return { name: row.name, relationshipType: row.relationshipType,
    state: row.state, domainIds: [...row.domainIds] };
}

export function buildPersonRelationshipTimeline(
  changes: readonly PersonRelationshipChange[],
): PersonRelationshipEntry[] {
  const seen = new Set<number>();
  const entries: PersonRelationshipEntry[] = [];
  for (const change of changes) {
    if (!Number.isSafeInteger(change.id) || change.id < 1 || seen.has(change.id) ||
      typeof change.personId !== "string" || !change.personId.trim() ||
      !isDomainHistoryTimestamp(change.changedAt)) invalid();
    seen.add(change.id);
    const before = parsePersonRelationshipSnapshot(change.before);
    const after = parsePersonRelationshipSnapshot(change.after);
    const details = (["relationshipType", "state"] as const).filter(field => before[field] !== after[field])
      .map(field => `${field === "state" ? "关系状态" : "关系类型"}：${before[field] || "未填写"} → ${after[field] || "未填写"}`);
    if (!details.length) continue;
    entries.push({ id: `person-relationship-${change.id}`, personId: change.personId,
      changedAt: change.changedAt, title: after.name, detail: details.join("；"),
      domainIds: [...new Set([...before.domainIds, ...after.domainIds])],
      change: { ...change, before, after } });
  }
  return entries.sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt) ||
    b.change.id - a.change.id);
}
