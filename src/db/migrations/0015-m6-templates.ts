import type { Migration } from "./types";

export const m6TemplatesMigration: Migration = {
  id: "0015-m6-templates",
  statements: [
    `CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('goal', 'review', 'issue', 'decision', 'export')),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      defaults_json TEXT NOT NULL CHECK (json_valid(defaults_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_templates_category ON templates (category, name)`,
  ],
};
