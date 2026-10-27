import { parsePersonRelationshipSnapshot, type PersonRelationshipChange } from "../../domain/records/PersonRelationshipHistory";
import type { PersonRelationshipHistoryRepository } from "../history/PersonRelationshipHistoryRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

export interface PersonRelationshipHistoryRow {
  id: number; person_id: string; changed_at: string; before_json: string; after_json: string;
}

export class SqlitePersonRelationshipHistoryRepository implements PersonRelationshipHistoryRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async listChanges(): Promise<readonly PersonRelationshipChange[]> {
    const rows = await this.executor.select<PersonRelationshipHistoryRow>(
      "SELECT id, person_id, changed_at, before_json, after_json FROM person_relationship_versions ORDER BY id ASC",
    );
    return rows.map(row => ({ id: row.id, personId: row.person_id, changedAt: row.changed_at,
      before: parsePersonRelationshipSnapshot(JSON.parse(row.before_json)),
      after: parsePersonRelationshipSnapshot(JSON.parse(row.after_json)) }));
  }
}
