import { normalizePersonDates, type PersonDate } from "../records/LifeRecords";

export function validatePersonDatesBackupData(data: Record<string, unknown>): void {
  if (!Array.isArray(data.people) || !Array.isArray(data.person_dates)) {
    throw new Error("备份缺少人物日期数据表。");
  }
  const people = new Set(data.people.map(row => (row as Record<string, unknown>).id));
  const positions = new Set<string>();
  const groups = new Map<string, PersonDate[]>();
  for (const value of data.person_dates) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("人物日期备份行无效。");
    }
    const row = value as Record<string, unknown>;
    const fields = ["person_id", "sort_order", "kind", "label", "happened_on"];
    if (Object.keys(row).length !== fields.length ||
      fields.some(field => !Object.prototype.hasOwnProperty.call(row, field)) ||
      typeof row.person_id !== "string" || !row.person_id.trim() || !people.has(row.person_id) ||
      !Number.isInteger(row.sort_order) || Number(row.sort_order) < 0 || Number(row.sort_order) > 20) {
      throw new Error("人物日期备份字段或归属无效。");
    }
    const key = JSON.stringify([row.person_id, row.sort_order]);
    if (positions.has(key)) throw new Error("人物日期备份排序标识重复。");
    positions.add(key);
    const group = groups.get(row.person_id) ?? [];
    group.push({ kind: row.kind as PersonDate["kind"], label: row.label as string,
      date: row.happened_on as string });
    groups.set(row.person_id, group);
  }
  for (const dates of groups.values()) normalizePersonDates(dates, false);
}
