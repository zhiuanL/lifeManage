import { localDate } from "../habits/Habit";
import { isPlainDate } from "../planning/Goal";
import { shiftCalendarDate } from "../planning/Calendar";
import type { LifeEvent } from "../records/LifeRecords";
import { attentionRulePreference, type AttentionSettings, type AttentionSignal } from "./Attention";

function timestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !isPlainDate(value.slice(0, 10))) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function findRecentEventSignals(
  events: readonly LifeEvent[], settings: AttentionSettings, now: Date,
): AttentionSignal[] {
  const preference = attentionRulePreference(settings, "recent-event");
  if (!preference.enabled || !Number.isFinite(now.getTime())) return [];
  const today = localDate(now);
  const days = settings.recentEventDays ?? 7;
  if (!isPlainDate(today) || !Number.isInteger(days) || days < 1 || days > 30) return [];
  const start = shiftCalendarDate(today, 1 - days);
  return events.filter(event => {
    const createdAt = timestamp(event.createdAt);
    const updatedAt = timestamp(event.updatedAt);
    return !event.archived && !!event.title.trim() &&
      isPlainDate(event.happenedOn) && event.happenedOn >= start && event.happenedOn <= today &&
      createdAt !== null && updatedAt !== null &&
      createdAt <= updatedAt && updatedAt <= now.getTime() &&
      (preference.scope === "all" || preference.domainIds.some(id => event.domainIds.includes(id)));
  }).map(event => ({
    id: `recent-event:${event.id}`, kind: "recent-event", title: event.title,
    summary: `事件记录的发生日期为 ${event.happenedOn}，在最近 ${days} 个日历日内。`,
    rule: "仅按已保存的重要事件发生日期提示；排除归档、未来日期和无效记录，不生成预约、周年或补记义务。",
    baseline: `含今天在内最近 ${days} 个日历日；只观察事件自身领域，不推断事件结果或影响。`,
    period: `${start} 至 ${today}`,
    domainIds: event.domainIds,
    sources: [
      { id: event.id, title: event.title, date: event.happenedOn,
        path: "/timeline", fragment: `event-${event.id}` },
      { id: `${event.id}:updated`, title: `${event.title} · 当前记录更新时间`, date: event.updatedAt,
        path: "/timeline", fragment: `event-${event.id}` },
    ],
  }));
}
