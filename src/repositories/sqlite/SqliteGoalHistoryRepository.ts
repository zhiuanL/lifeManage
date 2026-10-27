import type { GoalVersionFact } from "../../domain/records/GoalTimeline";
import type { GoalHistoryRepository } from "../history/GoalHistoryRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface Row {
  id: number;
  object_id: string;
  changed_at: string;
  snapshot_json: string;
}

export class SqliteGoalHistoryRepository implements GoalHistoryRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async listGoalVersions(): Promise<readonly GoalVersionFact[]> {
    const rows = await this.executor.select<Row>(
      `SELECT id, object_id, changed_at, snapshot_json
       FROM object_versions WHERE object_type = ? ORDER BY id ASC`, ["goal"],
    );
    return rows.map(row => ({ id: row.id, objectId: row.object_id,
      changedAt: row.changed_at, snapshot: JSON.parse(row.snapshot_json) as Record<string, unknown> }));
  }
}
