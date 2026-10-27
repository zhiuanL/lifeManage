import type { ObjectVersion, VersionType } from "../../domain/records/ObjectVersion";
import type { ObjectVersionRepository } from "../history/ObjectVersionRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface VersionRow {
  id: number; object_type: Exclude<VersionType, "role">; object_id: string;
  changed_at: string; snapshot_json: string;
}

export class SqliteObjectVersionRepository implements ObjectVersionRepository {
  constructor(private readonly db: SqliteExecutor) {}

  async list(type: Exclude<VersionType, "role">, objectId: string): Promise<readonly ObjectVersion[]> {
    const rows = await this.db.select<VersionRow>(
      `SELECT id, object_type, object_id, changed_at, snapshot_json
       FROM object_versions WHERE object_type = ? AND object_id = ? ORDER BY id DESC`,
      [type, objectId],
    );
    return rows.map(row => ({
      id: row.id, type: row.object_type, objectId: row.object_id,
      changedAt: row.changed_at, snapshot: JSON.parse(row.snapshot_json) as Record<string, unknown>,
    }));
  }
}
