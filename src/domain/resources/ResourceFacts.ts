import type { MetricDefinition, MetricRecord } from "../life/DomainMetric";
import { resourceKinds, type ResourceNeed } from "./Resources";

export function summarizeResourceNeeds(needs: readonly ResourceNeed[]) {
  return resourceKinds.map((kind) => {
    const records = needs.filter((need) => need.kind === kind);
    const met = records.filter((need) => need.met).length;
    return { kind, total: records.length, met, gap: records.length - met };
  });
}

export function latestResourceMetrics(
  definitions: readonly MetricDefinition[], records: readonly MetricRecord[], asOf: string,
) {
  return definitions.map((definition) => {
    const latest = records.filter((record) =>
      record.metricId === definition.id && record.recordedOn <= asOf)
      .sort((a, b) => b.recordedOn.localeCompare(a.recordedOn) ||
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0] ?? null;
    return { definition, latest };
  });
}
