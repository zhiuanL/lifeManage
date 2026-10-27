import type { MetricDefinition, MetricRecord } from "../../domain/life/DomainMetric";
import type { DomainSatisfactionLink } from "../../domain/life/DomainSatisfaction";
import type { DomainMetricRepository } from "../life/DomainMetricRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface DefinitionRow {
  id: string; name: string; unit: string; archived: number; created_at: string;
}
interface RecordRow {
  id: string; metric_id: string; recorded_on: string; value: number;
  note: string; created_at: string; updated_at: string;
}

export class SqliteDomainMetricRepository implements DomainMetricRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async listSatisfactionLinks(): Promise<readonly DomainSatisfactionLink[]> {
    const rows = await this.executor.select<{ domain_id: string; metric_id: string }>(
      "SELECT domain_id, metric_id FROM domain_satisfaction_links ORDER BY domain_id",
    );
    return rows.map(row => ({ domainId: row.domain_id, metricId: row.metric_id }));
  }

  async setSatisfactionMetric(domainId: string, metricId: string | null): Promise<void> {
    if (metricId === null) {
      await this.executor.execute("DELETE FROM domain_satisfaction_links WHERE domain_id = ?", [domainId]);
    } else {
      await this.executor.execute(
        `INSERT INTO domain_satisfaction_links (domain_id, metric_id) VALUES (?, ?)
         ON CONFLICT(domain_id) DO UPDATE SET metric_id = excluded.metric_id`,
        [domainId, metricId],
      );
    }
  }

  async listDefinitions(): Promise<readonly MetricDefinition[]> {
    const [rows, links] = await Promise.all([
      this.executor.select<DefinitionRow>(
        "SELECT id, name, unit, archived, created_at FROM metric_definitions ORDER BY created_at, id",
      ),
      this.executor.select<{ metric_id: string; domain_id: string }>(
        "SELECT metric_id, domain_id FROM metric_domain_links ORDER BY metric_id, domain_id",
      ),
    ]);
    return rows.map((row) => ({
      id: row.id, name: row.name, unit: row.unit, archived: row.archived === 1,
      createdAt: row.created_at,
      domainIds: links.filter((link) => link.metric_id === row.id).map((link) => link.domain_id),
    }));
  }

  async listRecords(): Promise<readonly MetricRecord[]> {
    const rows = await this.executor.select<RecordRow>(
      `SELECT id, metric_id, recorded_on, value, note, created_at, updated_at
       FROM metric_records ORDER BY recorded_on DESC, created_at DESC, id DESC`,
    );
    return rows.map((row) => ({
      id: row.id, metricId: row.metric_id, recordedOn: row.recorded_on,
      value: row.value, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  async createDefinition(definition: MetricDefinition): Promise<void> {
    await this.executor.executeTransaction([
      {
        statement: `INSERT INTO metric_definitions (id, name, unit, archived, created_at)
         VALUES (?, ?, ?, 0, ?)`,
        bindValues: [definition.id, definition.name, definition.unit, definition.createdAt],
      },
      ...definition.domainIds.map((domainId) => ({
        statement: "INSERT INTO metric_domain_links (metric_id, domain_id) VALUES (?, ?)",
        bindValues: [definition.id, domainId],
      })),
    ]);
  }

  async setArchived(id: string, archived: boolean): Promise<boolean> {
    const result = await this.executor.execute(
      "UPDATE metric_definitions SET archived = ? WHERE id = ?",
      [archived ? 1 : 0, id],
    );
    return result.rowsAffected > 0;
  }

  async createRecord(record: MetricRecord): Promise<void> {
    await this.executor.execute(
      `INSERT INTO metric_records (id, metric_id, recorded_on, value, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.metricId, record.recordedOn, record.value, record.note,
        record.createdAt, record.updatedAt],
    );
  }

  async updateRecord(record: MetricRecord): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE metric_records SET recorded_on = ?, value = ?, note = ?, updated_at = ?
       WHERE id = ? AND metric_id = ?`,
      [record.recordedOn, record.value, record.note, record.updatedAt, record.id, record.metricId],
    );
    return result.rowsAffected > 0;
  }
}
