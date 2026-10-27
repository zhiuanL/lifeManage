import { isPlainDate } from "../planning/Goal";
import type { Review } from "../reviews/Review";
import { normalizeReviewStructure, reviewPeriod, reviewTypes, reviewTypeLabels, type ReviewPeriod, type ReviewStructure, type ReviewType } from "../reviews/ReviewStructure";
import type { AttentionRulePreference, AttentionSignal } from "./Attention";

export const defaultReviewAttentionTypes: readonly ReviewType[] = ["weekly", "monthly", "quarterly", "annual"];

export interface ReviewSchedule {
  startOn: string;
  types: readonly ReviewType[];
  waitDays: number;
}

export function validateReviewSchedule(value: ReviewSchedule): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["startOn", "types", "waitDays"].includes(key)) ||
      typeof value.startOn !== "string" || !isPlainDate(value.startOn) ||
      !Array.isArray(value.types) || value.types.length > reviewTypes.length ||
      value.types.some(type => !reviewTypes.includes(type)) ||
      new Set(value.types).size !== value.types.length ||
      !Number.isInteger(value.waitDays) || value.waitDays < 1 || value.waitDays > 30) {
    throw new Error("请设置有效的复盘起始日期、不重复的周期及 1–30 天的等待时间。");
  }
}

function timestamp(value: string): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) ||
      !isPlainDate(value.slice(0, 10))) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function localDate(now: Date): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function shiftDate(value: string, days: number): string | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  if (!Number.isFinite(date.getTime())) return null;
  const result = date.toISOString().slice(0, 10);
  return isPlainDate(result) ? result : null;
}

function validStructure(review: Review, now: Date): ReviewStructure | null {
  const created = timestamp(review.createdAt);
  const updated = timestamp(review.updatedAt);
  if (!review.structure || created === null || updated === null || created > updated ||
      updated > now.getTime() || !isPlainDate(review.reviewedOn) || review.reviewedOn > localDate(now)) return null;
  try { return normalizeReviewStructure(review.structure); }
  catch { return null; }
}

export function findReviewDraftSignals(
  reviews: readonly Review[],
  preference: AttentionRulePreference,
  selectedTypes: readonly ReviewType[],
  waitDays: number,
  now: Date,
): AttentionSignal[] {
  const current = now.getTime();
  if (!preference.enabled || !Number.isFinite(current)) return [];
  const today = localDate(now);
  if (!isPlainDate(today)) return [];
  const signals: AttentionSignal[] = [];
  for (const review of reviews) {
    if (!review.structure || (preference.scope === "domains" &&
        !preference.domainIds.some(id => review.domainIds.includes(id)))) continue;
    // Missing reviews are not overdue; this rule observes explicitly saved drafts only.
    const structure = validStructure(review, now);
    if (!structure || structure.status !== "draft" || !selectedTypes.includes(structure.type) ||
        structure.end >= today) continue;
    const reminderOn = shiftDate(structure.end, waitDays);
    if (!reminderOn || reminderOn > today) continue;
    const cycle = reviewTypeLabels[structure.type];
    signals.push({
      id: `review-draft:${review.id}`, kind: "review-draft", title: review.title,
      summary: `${cycle}周期 ${structure.start} 至 ${structure.end} 已结束，当前仍为草稿。`,
      rule: `仅提示已保存且周期结束后达到 ${waitDays} 天的${cycle}草稿；不以漏写记录触发。`,
      baseline: `保存的复盘周期：${structure.start} 至 ${structure.end}；按规则计算的提示日期：${reminderOn}，不是用户约定的截止日。` +
        "使用当前草稿状态，不推断完成历史或原因，也不代替同周期的其他复盘记录。",
      period: `${structure.start} 至 ${today}`,
      domainIds: review.domainIds,
      sources: [{
        id: review.id, title: `${review.title}（${cycle}草稿）`, date: review.updatedAt,
        path: "/reviews", fragment: `review-${review.id}`,
      }],
    });
  }
  return signals;
}

export function findScheduledReviewSignals(
  reviews: readonly Review[],
  preference: AttentionRulePreference,
  schedule: ReviewSchedule | undefined,
  now: Date,
): AttentionSignal[] {
  if (!preference.enabled || !schedule || !Number.isFinite(now.getTime()) ||
      (preference.scope === "domains" && preference.domainIds.length === 0)) return [];
  validateReviewSchedule(schedule);
  const today = localDate(now);
  if (!isPlainDate(today) || schedule.startOn > today) return [];
  const cutoff = shiftDate(today, -schedule.waitDays);
  if (!cutoff) return [];
  const records = reviews.filter(review => preference.scope === "all" ||
    preference.domainIds.some(id => review.domainIds.includes(id)))
    .map(review => ({ review, structure: validStructure(review, now) }));
  const signals: AttentionSignal[] = [];
  for (const type of schedule.types) {
    let period: ReviewPeriod;
    try {
      period = reviewPeriod(type, cutoff);
      if (period.end > cutoff) {
        const previous = shiftDate(period.start, -1);
        if (!previous) continue;
        period = reviewPeriod(type, previous);
      }
    } catch { continue; }
    // Never build a missed-period backlog or infer a commitment before activation.
    if (period.start < schedule.startOn) continue;
    const matching = records.filter(({ structure }) => structure?.type === type &&
      structure.start === period.start && structure.end === period.end);
    if (matching.some(({ structure }) => structure?.status === "completed")) continue;
    const reminderOn = shiftDate(period.end, schedule.waitDays);
    if (!reminderOn || reminderOn > today) continue;
    const cycle = reviewTypeLabels[type];
    const create = new URLSearchParams({
      create: "review", reviewType: type, reviewAnchor: period.end,
    });
    if (preference.scope === "domains") {
      for (const id of preference.domainIds) create.append("reviewDomain", id);
    }
    const drafts = matching.filter(({ structure }) => structure?.status === "draft");
    signals.push({
      id: `review-due:${type}:${period.start}`, kind: "review-due",
      title: `${cycle}节点`,
      summary: `${period.start} 至 ${period.end} 的${cycle}已到提示日期，所选范围内尚无已完成记录。` +
        (drafts.length ? `已有 ${drafts.length} 份草稿可继续整理。` : ""),
      rule: `用户已启用此周期；结束后等待 ${schedule.waitDays} 天，每个周期类型只提示最近一个已到期的完整周期。`,
      baseline: `起始日期：${schedule.startOn}；本周期提示日期：${reminderOn}。不回补起始日期之前或跨越起始日期的周期。` +
        "所选范围内任一已完成复盘即可满足此周期，不按领域复制记录；仅依据当前状态，不判断漏写原因或失败。",
      period: `${period.start} 至 ${today}`,
      domainIds: preference.scope === "domains" ? preference.domainIds : [],
      sources: [
        { id: "review-schedule", title: "已保存的周期复盘设置", date: schedule.startOn,
          path: "/settings", fragment: "settings-attention-title" },
        ...drafts.map(({ review }) => ({
          id: review.id, title: `${review.title}（${cycle}草稿）`, date: review.updatedAt,
          path: "/reviews" as const, fragment: `review-${review.id}`,
        })),
      ],
      ...(drafts.length ? {} : { action: { label: `开始${cycle}`, to: `/reviews?${create.toString()}` } }),
    });
  }
  return signals;
}
