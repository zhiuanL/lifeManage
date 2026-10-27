import type { Migration } from "./types";

export const v1DomainTemplatesMigration: Migration = {
  id: "0047-v1-domain-templates",
  statements: [
    `CREATE TABLE templates_v47 (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN
        ('goal', 'review', 'domain', 'issue', 'decision', 'habit', 'export')),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      defaults_json TEXT NOT NULL CHECK (json_valid(defaults_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `INSERT INTO templates_v47
      (id, category, name, version, defaults_json, created_at, updated_at)
      SELECT id, category, name, version, defaults_json, created_at, updated_at FROM templates`,
    `DROP TABLE templates`,
    `ALTER TABLE templates_v47 RENAME TO templates`,
    `CREATE INDEX idx_templates_category ON templates (category, name)`,
  ],
};
