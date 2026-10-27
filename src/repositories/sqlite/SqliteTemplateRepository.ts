import type { Template, TemplateCategory } from "../../domain/templates/Template";
import type { TemplateRepository } from "../templates/TemplateRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface TemplateRow {
  id: string; category: TemplateCategory; name: string; version: number;
  defaults_json: string; created_at: string; updated_at: string;
}

function fromRow(row: TemplateRow): Template {
  return {
    id: row.id, category: row.category, name: row.name, version: row.version,
    defaults: JSON.parse(row.defaults_json) as Template["defaults"],
    builtIn: false, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class SqliteTemplateRepository implements TemplateRepository {
  constructor(private readonly db: SqliteExecutor) {}

  async list(): Promise<readonly Template[]> {
    const rows = await this.db.select<TemplateRow>(
      "SELECT id, category, name, version, defaults_json, created_at, updated_at FROM templates ORDER BY category, name",
    );
    return rows.map(fromRow);
  }

  async findById(id: string): Promise<Template | null> {
    const rows = await this.db.select<TemplateRow>(
      "SELECT id, category, name, version, defaults_json, created_at, updated_at FROM templates WHERE id = ?",
      [id],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async create(template: Template): Promise<boolean> {
    const result = await this.db.execute(
      "INSERT INTO templates (id, category, name, version, defaults_json, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
      [template.id, template.category, template.name, JSON.stringify(template.defaults),
        template.createdAt, template.updatedAt],
    );
    return result.rowsAffected === 1;
  }

  async update(template: Template): Promise<boolean> {
    const result = await this.db.execute(
      "UPDATE templates SET name = ?, defaults_json = ?, version = version + 1, updated_at = ? WHERE id = ?",
      [template.name, JSON.stringify(template.defaults), template.updatedAt, template.id],
    );
    return result.rowsAffected === 1;
  }
}
