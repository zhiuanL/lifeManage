import type { MetricDefinition, MetricRecord } from "../life/DomainMetric";
import { isPlainDate } from "../planning/Goal";

export interface DomainMetricTrend {
  definition: MetricDefinition;
  records: readonly MetricRecord[];
}

export function recentMetricWindow(end: string): { start: string; end: string } | null {
  if (!isPlainDate(end)) return null;
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { start: start.toISOString().slice(0, 10), end };
}

export function buildDomainMetricTrends(
  definitions: readonly MetricDefinition[],
  records: readonly MetricRecord[],
  domainId: string | null,
  goalId: string | null,
  start: string,
  end: string,
): readonly DomainMetricTrend[] {
  if (goalId) return [];
  return definitions
    .filter((definition) => !domainId || definition.domainIds.includes(domainId))
    .map((definition) => ({
      definition,
      records: records.filter((record) => record.metricId === definition.id &&
        record.recordedOn >= start && record.recordedOn <= end)
        .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn)),
    }));
}
