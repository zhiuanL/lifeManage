import type { Migration } from "./types";

export const m0FoundationMigration: Migration = {
  id: "0001-m0-foundation",
  statements: [
    `CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
};
