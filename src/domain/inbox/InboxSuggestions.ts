import { isPlainDate } from "../planning/Goal";
import { inboxTargetHref, type InboxTarget } from "./InboxItem";

export interface InboxDateSuggestion {
  date: string;
  text: string;
  reason: string;
}

export interface InboxObjectCandidate {
  type: InboxTarget | "domain";
  id: string;
  name: string;
  state: string;
}

export interface InboxObjectSuggestion extends InboxObjectCandidate {
  reason: string;
  href: string;
}

function plainDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function suggestInboxDates(content: string, capturedAt: string): readonly InboxDateSuggestion[] {
  const captured = new Date(capturedAt);
  const base = Number.isFinite(captured.getTime())
    ? plainDate(captured.getFullYear(), captured.getMonth() + 1, captured.getDate()) : null;
  const suggestions: InboxDateSuggestion[] = [];
  const occupied: { start: number; end: number }[] = [];
  function add(date: string, text: string, reason: string) {
    if (isPlainDate(date) && !suggestions.some(item => item.date === date)) {
      suggestions.push({ date, text, reason });
    }
  }
  // Reserve even invalid full-date spans so their month/day cannot become a different suggestion.
  const fullDate = /(?<!\d)(?:(\d{4})([-/.])(\d{1,2})\2(\d{1,2})|(\d{4})年(\d{1,2})月(\d{1,2})[日号]?)(?!\d)/g;
  for (const match of content.matchAll(fullDate)) {
    occupied.push({ start: match.index, end: match.index + match[0].length });
    const date = plainDate(Number(match[1] ?? match[5]), Number(match[3] ?? match[6]),
      Number(match[4] ?? match[7]));
    add(date, match[0], `原文中的完整日期「${match[0]}」`);
  }
  if (!base || !isPlainDate(base)) return suggestions;
  for (const match of content.matchAll(/(?<![\d年])(\d{1,2})月(\d{1,2})[日号](?!\d)/g)) {
    if (occupied.some(span => match.index >= span.start && match.index < span.end)) continue;
    add(plainDate(captured.getFullYear(), Number(match[1]), Number(match[2])), match[0],
      `「${match[0]}」未写年份，暂按收集日期 ${base} 所在年份`);
  }
  const offsets: Record<string, number> = { 今天: 0, 明天: 1, 昨天: -1 };
  for (const match of content.matchAll(/今天|明天|昨天/g)) {
    const date = new Date(`${base}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offsets[match[0]]);
    add(plainDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()), match[0],
      `「${match[0]}」以收集日期 ${base} 为参照`);
  }
  return suggestions;
}

function includesName(content: string, name: string): boolean {
  let start = content.indexOf(name);
  while (start !== -1) {
    const left = content[start - 1] ?? "";
    const right = content[start + name.length] ?? "";
    if ((!/^[a-z0-9_]/.test(name) || !/[a-z0-9_]/.test(left)) &&
        (!/[a-z0-9_]$/.test(name) || !/[a-z0-9_]/.test(right))) return true;
    start = content.indexOf(name, start + 1);
  }
  return false;
}

export function suggestInboxObjects(
  content: string, candidates: readonly InboxObjectCandidate[],
): readonly InboxObjectSuggestion[] {
  const text = content.trim().toLowerCase();
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const name = candidate.name.trim().toLowerCase();
    const key = `${candidate.type}:${candidate.id}`;
    if (!name || !candidate.id || seen.has(key)) return false;
    if (text !== name && ([...name].length < 2 || !includesName(text, name))) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => {
    const exactA = Number(text === a.name.trim().toLowerCase());
    const exactB = Number(text === b.name.trim().toLowerCase());
    return exactB - exactA || b.name.trim().length - a.name.trim().length ||
      a.type.localeCompare(b.type) || a.id.localeCompare(b.id);
  }).map(candidate => ({
    ...candidate,
    reason: text === candidate.name.trim().toLowerCase()
      ? `原文与已有名称「${candidate.name}」相同`
      : `原文包含已有名称「${candidate.name}」`,
    href: candidate.type === "domain" ? `/domains/${encodeURIComponent(candidate.id)}`
      : inboxTargetHref(candidate.type, candidate.id),
  }));
}
