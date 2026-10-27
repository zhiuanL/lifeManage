import type { LandscapeContext } from "../../domain/life/LandscapeContext";
import type { LandscapeContextRepository } from "../life/LandscapeContextRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

export interface LandscapeContextRow {
  id: string; life_state: string; current_stage: string;
  current_focus: string; life_tensions: string; updated_at: string;
}
export class SqliteLandscapeContextRepository implements LandscapeContextRepository {
  constructor(private readonly executor: SqliteExecutor) {}
  async get(): Promise<LandscapeContext | null> {
    const [row] = await this.executor.select<LandscapeContextRow>(
      "SELECT * FROM landscape_context WHERE id = 'current'",
    );
    return row ? { lifeState: row.life_state, currentStage: row.current_stage,
      currentFocus: row.current_focus, lifeTensions: row.life_tensions, updatedAt: row.updated_at } : null;
  }
  async save(context: LandscapeContext): Promise<void> {
    await this.executor.execute(
      `INSERT INTO landscape_context (id, life_state, current_stage, current_focus, life_tensions, updated_at)
       VALUES ('current', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET life_state = excluded.life_state, current_stage = excluded.current_stage,
       current_focus = excluded.current_focus, life_tensions = excluded.life_tensions, updated_at = excluded.updated_at`,
      [context.lifeState, context.currentStage, context.currentFocus, context.lifeTensions, context.updatedAt],
    );
  }
}
