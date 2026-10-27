import type { MetricDefinition, MetricRecord } from "./DomainMetric";

export interface DomainSatisfactionLink {
  domainId: string;
  metricId: string;
}

export function domainSatisfaction(
  domainId: string, links: readonly DomainSatisfactionLink[],
  definitions: readonly MetricDefinition[], records: readonly MetricRecord[],
) {
  const link = links.find(item => item.domainId === domainId);
  if (!link) return { kind: "none" } as const;
  const definition = definitions.find(item => item.id === link.metricId && item.domainIds.includes(domainId));
  if (!definition) return { kind: "unavailable" } as const;
  const latest = records.filter(item => item.metricId === definition.id).sort((a, b) =>
    b.recordedOn.localeCompare(a.recordedOn) || b.createdAt.localeCompare(a.createdAt) ||
    b.id.localeCompare(a.id))[0] ?? null;
  return { kind: "selected", definition, latest } as const;
}
