import {
  MetricValidationError, normalizeMetricDefinition, normalizeMetricRecord,
  type MetricDefinition, type MetricRecord,
} from "../../domain/life/DomainMetric";
import type { DomainMetricRepository } from "../../repositories/life/DomainMetricRepository";
import type { LifeDomainRepository } from "../../repositories/life/LifeDomainRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import type { DomainSatisfactionLink } from "../../domain/life/DomainSatisfaction";

export class DomainMetricService {
  constructor(
    private readonly repository: DomainMetricRepository,
    private readonly domains: LifeDomainRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  listSatisfactionLinks(): Promise<readonly DomainSatisfactionLink[]> {
    return this.repository.listSatisfactionLinks();
  }

  async setSatisfactionMetric(domainId: string, metricId: string | null): Promise<void> {
    if (!(await this.domains.findById(domainId))) {
      throw new MetricValidationError("生活领域已经不存在，请重新读取后再试。");
    }
    if (metricId !== null) {
      const metric = (await this.repository.listDefinitions()).find(item => item.id === metricId);
      if (!metric || !metric.domainIds.includes(domainId)) {
        throw new MetricValidationError("请选择关联到这个领域的评分指标。");
      }
      if (metric.archived) throw new MetricValidationError("指标已归档，请先恢复或选择其他指标。");
    }
    await this.repository.setSatisfactionMetric(domainId, metricId);
  }

  listDefinitions(): Promise<readonly MetricDefinition[]> {
    return this.repository.listDefinitions();
  }

  listRecords(): Promise<readonly MetricRecord[]> {
    return this.repository.listRecords();
  }

  async createDefinition(name: string, unit: string, domainIds: readonly string[]): Promise<MetricDefinition> {
    const normalized = normalizeMetricDefinition(name, unit, domainIds);
    for (const id of normalized.domainIds) {
      if (!(await this.domains.findById(id))) throw new MetricValidationError("关联的生活领域已经不存在了。");
    }
    const definition: MetricDefinition = {
      id: this.ids.next(), ...normalized, archived: false,
      createdAt: this.clock.now().toISOString(),
    };
    await this.repository.createDefinition(definition);
    return definition;
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    if (!(await this.repository.setArchived(id, archived))) {
      throw new MetricValidationError("指标已经不存在，请重新读取后再试。");
    }
  }

  async saveRecord(
    metricId: string, recordedOn: string, value: number, note: string, recordId?: string,
  ): Promise<MetricRecord> {
    const normalized = normalizeMetricRecord(recordedOn, value, note);
    const definition = (await this.repository.listDefinitions()).find((item) => item.id === metricId);
    if (!definition) throw new MetricValidationError("指标已经不存在，请重新读取后再试。");
    if (definition.archived) throw new MetricValidationError("指标已归档，请先恢复再记录。");
    const records = await this.repository.listRecords();
    const existing = recordId ? records.find((item) => item.id === recordId && item.metricId === metricId) : null;
    if (recordId && !existing) throw new MetricValidationError("记录已经不存在，请重新读取后再试。");
    if (records.some((item) => item.metricId === metricId &&
        item.recordedOn === normalized.recordedOn && item.id !== recordId)) {
      throw new MetricValidationError("这个日期已经有记录，请选择该条记录进行更正。");
    }
    const timestamp = this.clock.now().toISOString();
    const record: MetricRecord = {
      id: existing?.id ?? this.ids.next(), metricId, ...normalized,
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp,
    };
    if (existing) {
      if (!(await this.repository.updateRecord(record))) throw new MetricValidationError("记录已经不存在，请重新读取后再试。");
    } else {
      await this.repository.createRecord(record);
    }
    return record;
  }
}
