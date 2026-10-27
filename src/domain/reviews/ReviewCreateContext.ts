import { reviewPeriod, reviewTypes, type ReviewType } from "./ReviewStructure";

export interface ReviewCreateContext {
  type: ReviewType;
  anchor: string;
  domainIds: readonly string[];
}

export function normalizeReviewCreateContext(value: {
  type: string; anchor: string; domainIds: readonly string[];
}): ReviewCreateContext {
  if (!reviewTypes.includes(value.type as ReviewType) || !Array.isArray(value.domainIds) ||
      value.domainIds.length > 200 ||
      value.domainIds.some(id => typeof id !== "string" || !id.trim() || id.length > 200)) {
    throw new Error("复盘入口的周期或领域无效，请重新打开。");
  }
  const type = value.type as ReviewType;
  try { reviewPeriod(type, value.anchor); }
  catch { throw new Error("复盘入口的日期无效，请重新打开。"); }
  return { type, anchor: value.anchor, domainIds: [...new Set(value.domainIds.map(id => id.trim()))] };
}

export function reviewCreatePath(context: ReviewCreateContext): string {
  const normalized = normalizeReviewCreateContext(context);
  const params = new URLSearchParams({
    create: "review", reviewType: normalized.type, reviewAnchor: normalized.anchor,
  });
  for (const id of normalized.domainIds) params.append("reviewDomain", id);
  return `/reviews?${params.toString()}`;
}
