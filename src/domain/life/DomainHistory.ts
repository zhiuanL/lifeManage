import { domainColorKeys, domainIconKeys, domainStatuses } from "./LifeDomain";
import { isPlainDate } from "../planning/Goal";

export const domainHistoryFields = ["name", "description", "focus", "color_key",
  "icon_key", "current_state", "long_term_expectation", "status"] as const;
export type DomainHistorySnapshot = Record<(typeof domainHistoryFields)[number], string>;
export interface DomainChange {
  id: number;
  domainId: string;
  changedAt: string;
  before: DomainHistorySnapshot;
  after: DomainHistorySnapshot;
}
export interface DomainTimelineEntry {
  id: string;
  domainId: string;
  changedAt: string;
  title: string;
  detail: string;
  change: DomainChange;
}

function invalid(): never { throw new Error("领域历史包含无效记录。"); }

export function parseDomainHistorySnapshot(value: unknown): DomainHistorySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== domainHistoryFields.length ||
    domainHistoryFields.some(field => typeof record[field] !== "string")) return invalid();
  const snapshot = record as DomainHistorySnapshot;
  const limits = { name: 28, description: 280, focus: 120, current_state: 500, long_term_expectation: 500 };
  // Validate without normalizing: historical text must remain exactly as stored.
  if (!snapshot.name.trim() || Object.entries(limits).some(([field, max]) =>
    snapshot[field as keyof typeof limits].length > max) ||
    !domainColorKeys.some(value => value === snapshot.color_key) ||
    !domainIconKeys.some(value => value === snapshot.icon_key) ||
    !domainStatuses.some(value => value === snapshot.status)) return invalid();
  return { ...snapshot };
}

export function isDomainHistoryTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) &&
    isPlainDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

const labels: Record<(typeof domainHistoryFields)[number], string> = {
  name: "名称", description: "说明", focus: "当下关注", color_key: "色彩",
  icon_key: "图标", current_state: "当前状态", long_term_expectation: "长期期待", status: "领域状态",
};
export const domainHistoryStatusLabels: Record<string, string> = {
  active: "活跃", paused: "暂停", archived: "归档",
};

export function buildDomainTimeline(changes: readonly DomainChange[]): DomainTimelineEntry[] {
  const seen = new Set<number>();
  const entries: DomainTimelineEntry[] = [];
  for (const change of changes) {
    if (!Number.isSafeInteger(change.id) || change.id < 1 || seen.has(change.id) ||
      typeof change.domainId !== "string" || !change.domainId.trim() ||
      !isDomainHistoryTimestamp(change.changedAt)) invalid();
    seen.add(change.id);
    const before = parseDomainHistorySnapshot(change.before);
    const after = parseDomainHistorySnapshot(change.after);
    const changed = domainHistoryFields.filter(field => before[field] !== after[field]);
    if (!changed.length) continue;
    const detail = changed.map(field => field === "name"
      ? `名称：${before.name} → ${after.name}`
      : field === "status"
        ? `领域状态：${domainHistoryStatusLabels[before.status]} → ${domainHistoryStatusLabels[after.status]}`
        : `${labels[field]}已调整`).join("；");
    entries.push({ id: `domain-change-${change.id}`, domainId: change.domainId,
      changedAt: change.changedAt, title: after.name, detail,
      change: { ...change, before, after } });
  }
  return entries.sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt) ||
    b.change.id - a.change.id);
}
