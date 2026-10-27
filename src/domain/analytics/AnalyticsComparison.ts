import { buildAnalytics, type AnalyticsData, type AnalyticsSnapshot, type AnalyticsWeeks } from "./Analytics";

export interface DomainAnalyticsComparison {
  domainId: string;
  snapshot: AnalyticsSnapshot;
}

export function buildAnalyticsComparison(
  data: AnalyticsData,
  filter: { domainIds: readonly string[]; goalId: string | null; weeks: AnalyticsWeeks },
  now: Date,
): readonly DomainAnalyticsComparison[] {
  if (filter.domainIds.some(id => !id)) throw new Error("请选择明确的对比领域。");
  return [...new Set(filter.domainIds)].map(domainId => ({
    domainId,
    snapshot: buildAnalytics(data, { domainId, goalId: filter.goalId, weeks: filter.weeks }, now),
  }));
}
