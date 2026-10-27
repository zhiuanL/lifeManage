import { buildPersonRelationshipTimeline, parsePersonRelationshipSnapshot,
  type PersonRelationshipChange } from "../records/PersonRelationshipHistory";

export function validatePersonRelationshipHistoryBackupData(data: Record<string, unknown>): void {
  if (!Array.isArray(data.person_relationship_versions) || !Array.isArray(data.people) ||
    !Array.isArray(data.life_domains)) throw new Error("备份缺少人物关系历史数据表。");
  const people = new Set(data.people.map(row => (row as Record<string, unknown>).id));
  const domains = new Set(data.life_domains.map(row => (row as Record<string, unknown>).id));
  const fields = ["id", "person_id", "changed_at", "before_json", "after_json"];
  const changes: PersonRelationshipChange[] = data.person_relationship_versions.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("人物关系历史备份记录无效。");
    }
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== fields.length ||
      fields.some(field => !Object.prototype.hasOwnProperty.call(row, field)) ||
      !people.has(row.person_id) || typeof row.before_json !== "string" || typeof row.after_json !== "string") {
      throw new Error("人物关系历史备份字段或归属无效。");
    }
    const before = parsePersonRelationshipSnapshot(JSON.parse(row.before_json));
    const after = parsePersonRelationshipSnapshot(JSON.parse(row.after_json));
    if ([...before.domainIds, ...after.domainIds].some(id => !domains.has(id))) {
      throw new Error("人物关系历史引用不存在的领域。");
    }
    return { id: row.id as number, personId: row.person_id as string,
      changedAt: row.changed_at as string, before, after };
  });
  buildPersonRelationshipTimeline(changes);
}
