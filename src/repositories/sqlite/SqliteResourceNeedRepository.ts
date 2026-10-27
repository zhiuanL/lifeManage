import type { ResourceNeed } from "../../domain/resources/Resources";
import type { ResourceNeedRepository } from "../resources/ResourceNeedRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

type NeedRow = { id: string; goal_id: string | null; decision_id?: string | null; kind: ResourceNeed["kind"];
  description: string; skill_id: string | null; person_id: string | null;
  met: number; created_at: string; updated_at: string };

export class SqliteResourceNeedRepository implements ResourceNeedRepository {
  constructor(private readonly db: SqliteExecutor) {}

  async list(): Promise<readonly ResourceNeed[]> {
    const rows = await this.db.select<NeedRow>(
      "SELECT * FROM resource_needs ORDER BY met, created_at DESC, id DESC");
    return rows.map((row) => ({
      id: row.id, goalId: row.goal_id, decisionId: row.decision_id ?? null, kind: row.kind, description: row.description,
      skillId: row.skill_id, personId: row.person_id, met: row.met === 1,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  async save(item: ResourceNeed, create: boolean): Promise<boolean> {
    const result = create
      ? await this.db.execute(
        "INSERT INTO resource_needs (id, goal_id, kind, description, skill_id, person_id, met, created_at, updated_at, decision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [item.id, item.goalId, item.kind, item.description, item.skillId,
          item.personId, item.met ? 1 : 0, item.createdAt, item.updatedAt, item.decisionId ?? null])
      : await this.db.execute(
        "UPDATE resource_needs SET goal_id = ?, kind = ?, description = ?, skill_id = ?, person_id = ?, met = ?, updated_at = ?, decision_id = ? WHERE id = ?",
        [item.goalId, item.kind, item.description, item.skillId, item.personId,
          item.met ? 1 : 0, item.updatedAt, item.decisionId ?? null, item.id]);
    return result.rowsAffected > 0;
  }
}

