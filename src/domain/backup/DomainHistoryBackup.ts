import { buildDomainTimeline, parseDomainHistorySnapshot, type DomainChange } from "../life/DomainHistory";

export function validateDomainHistoryBackupData(data: Record<string, unknown>): void {
  if (!Array.isArray(data.life_domain_versions) || !Array.isArray(data.life_domains)) {
    throw new Error("备份缺少领域历史数据表。");
  }
  const domains = new Set(data.life_domains.map(row => (row as Record<string, unknown>).id));
  const changes: DomainChange[] = data.life_domain_versions.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("领域历史备份记录无效。");
    }
    const row = value as Record<string, unknown>;
    const fields = ["id", "domain_id", "changed_at", "before_json", "after_json"];
    if (Object.keys(row).length !== fields.length ||
      fields.some(field => !Object.prototype.hasOwnProperty.call(row, field)) ||
      !domains.has(row.domain_id) || typeof row.before_json !== "string" || typeof row.after_json !== "string") {
      throw new Error("领域历史备份字段或归属无效。");
    }
    return { id: row.id as number, domainId: row.domain_id as string, changedAt: row.changed_at as string,
      before: parseDomainHistorySnapshot(JSON.parse(row.before_json)),
      after: parseDomainHistorySnapshot(JSON.parse(row.after_json)) };
  });
  buildDomainTimeline(changes);
}
