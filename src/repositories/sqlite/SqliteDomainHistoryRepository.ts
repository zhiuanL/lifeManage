import { parseDomainHistorySnapshot, type DomainChange } from "../../domain/life/DomainHistory";
import type { DomainHistoryRepository } from "../history/DomainHistoryRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

export interface DomainHistoryRow {
  id: number; domain_id: string; changed_at: string; before_json: string; after_json: string;
}

export class SqliteDomainHistoryRepository implements DomainHistoryRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async listChanges(): Promise<readonly DomainChange[]> {
    const rows = await this.executor.select<DomainHistoryRow>(
      "SELECT id, domain_id, changed_at, before_json, after_json FROM life_domain_versions ORDER BY id ASC",
    );
    return rows.map(row => ({ id: row.id, domainId: row.domain_id, changedAt: row.changed_at,
      before: parseDomainHistorySnapshot(JSON.parse(row.before_json)),
      after: parseDomainHistorySnapshot(JSON.parse(row.after_json)) }));
  }
}
