import type { Migration } from "./types";
export const v1LifeNavigationMigration: Migration = {
  id: "0032-v1-life-navigation",
  statements: [
    `CREATE TABLE life_navigation (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('mission', 'value', 'vision', 'principle')),
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 6000),
      archived_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX life_navigation_kind ON life_navigation(kind, archived_at)`,
  ],
};
