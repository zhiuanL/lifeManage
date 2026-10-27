import type { LifeNavigation, NavigationDraft, NavigationKind } from "../../domain/life/LifeNavigation";
import type { LifeNavigationRepository } from "../life/LifeNavigationRepository";
import type { SqliteExecutor } from "./SqliteExecutor";
interface NavigationRow {
  id: string; kind: NavigationKind; title: string; description: string;
  archived_at: string | null; created_at: string; updated_at: string;
}
function toNavigation(row: NavigationRow): LifeNavigation {
  return { id: row.id, kind: row.kind, title: row.title, description: row.description,
    archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
export class SqliteLifeNavigationRepository implements LifeNavigationRepository {
  constructor(private readonly executor: SqliteExecutor) {}
  async list(): Promise<readonly LifeNavigation[]> {
    return (await this.executor.select<NavigationRow>(
      "SELECT * FROM life_navigation ORDER BY created_at, id")).map(toNavigation);
  }
  async findById(id: string): Promise<LifeNavigation | null> {
    const rows = await this.executor.select<NavigationRow>("SELECT * FROM life_navigation WHERE id = ?", [id]);
    return rows[0] ? toNavigation(rows[0]) : null;
  }
  async insert(record: LifeNavigation): Promise<void> {
    await this.executor.execute(`INSERT INTO life_navigation
      (id, kind, title, description, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.kind, record.title, record.description, record.archivedAt, record.createdAt, record.updatedAt]);
  }
  async update(id: string, draft: NavigationDraft, updatedAt: string): Promise<void> {
    const results = await this.executor.executeTransaction([{
      statement: "UPDATE life_navigation SET title = ?, description = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
      bindValues: [draft.title, draft.description, updatedAt, id], requireAffectedRows: true,
    }]);
    if (!results) throw new Error("记录已归档或不存在，请重新打开。");
  }
  async setArchived(id: string, archivedAt: string | null, updatedAt: string): Promise<void> {
    const results = await this.executor.executeTransaction([{
      statement: "UPDATE life_navigation SET archived_at = ?, updated_at = ? WHERE id = ?",
      bindValues: [archivedAt, updatedAt, id], requireAffectedRows: true,
    }]);
    if (!results) throw new Error("导航记录不存在。");
  }
}
