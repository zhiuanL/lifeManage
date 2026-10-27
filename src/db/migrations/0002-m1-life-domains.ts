import type { Migration } from "./types";

export const m1LifeDomainsMigration: Migration = {
  id: "0002-m1-life-domains",
  statements: [
    `CREATE TABLE IF NOT EXISTS life_domains (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      description TEXT NOT NULL DEFAULT '',
      focus TEXT NOT NULL DEFAULT '',
      color_key TEXT NOT NULL,
      icon_key TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_life_domains_sort_order
     ON life_domains (sort_order, created_at)`,
  ],
};
