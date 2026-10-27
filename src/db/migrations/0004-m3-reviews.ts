import type { Migration } from "./types";

export const m3ReviewsMigration: Migration = {
  id: "0004-m3-reviews",
  statements: [
    `CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      reflection TEXT NOT NULL DEFAULT '',
      insight TEXT NOT NULL DEFAULT '',
      next_focus TEXT NOT NULL DEFAULT '',
      domain_id TEXT REFERENCES life_domains(id) ON DELETE SET NULL,
      reviewed_on TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_on
     ON reviews (reviewed_on DESC, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_reviews_domain_id
     ON reviews (domain_id)`,
  ],
};
