import { isPlainDate } from "../planning/Goal";

export const searchTypes = [
  "domain", "goal", "action", "review", "issue", "decision", "inbox", "metric", "habit",
  "person", "event", "skill", "navigation", "role",
] as const;
export type SearchType = (typeof searchTypes)[number];

export const searchTypeLabels: Record<SearchType, string> = {
  domain: "生活领域", goal: "目标", action: "行动", review: "回顾",
  issue: "问题", decision: "决策", inbox: "收集箱", metric: "领域指标",
  habit: "习惯",
  person: "人物", event: "重要事件", skill: "能力", navigation: "人生导航", role: "身份角色",
};

export interface SearchEntry {
  type: SearchType;
  id: string;
  title: string;
  content: string;
  date: string;
  status: string;
  domainIds: readonly string[];
  href: string;
}

export interface SearchFilter {
  query: string;
  types: readonly SearchType[];
  from: string;
  to: string;
  status: string;
  domainId: string;
}

export function searchEntries(entries: readonly SearchEntry[], filter: SearchFilter): SearchEntry[] {
  if ((filter.from && !isPlainDate(filter.from)) || (filter.to && !isPlainDate(filter.to)) ||
      (filter.from && filter.to && filter.from > filter.to)) {
    throw new Error("请选择有效的搜索日期范围。");
  }
  const terms = filter.query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return entries.filter((entry) =>
    filter.types.includes(entry.type) &&
    (!filter.from || entry.date >= filter.from) &&
    (!filter.to || entry.date <= filter.to) &&
    (!filter.status || entry.status === filter.status) &&
    (!filter.domainId || entry.domainIds.includes(filter.domainId)) &&
    terms.every((term) => `${entry.title} ${entry.content}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type) ||
      a.id.localeCompare(b.id));
}
