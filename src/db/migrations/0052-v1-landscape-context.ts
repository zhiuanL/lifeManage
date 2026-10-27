import type { Migration } from "./types";
export const v1LandscapeContextMigration: Migration = {
  id: "0052-v1-landscape-context",
  statements: [
    `CREATE TABLE landscape_context (
      id TEXT PRIMARY KEY NOT NULL CHECK (id = 'current'),
      life_state TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      current_focus TEXT NOT NULL,
      life_tensions TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
};
