import type { MetricDefinition, MetricRecord } from "../../domain/life/DomainMetric";
import type { DomainSatisfactionLink } from "../../domain/life/DomainSatisfaction";

export interface DomainMetricRepository {
  listSatisfactionLinks(): Promise<readonly DomainSatisfactionLink[]>;
  setSatisfactionMetric(domainId: string, metricId: string | null): Promise<void>;
  listDefinitions(): Promise<readonly MetricDefinition[]>;
  listRecords(): Promise<readonly MetricRecord[]>;
  createDefinition(definition: MetricDefinition): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<boolean>;
  createRecord(record: MetricRecord): Promise<void>;
  updateRecord(record: MetricRecord): Promise<boolean>;
}
