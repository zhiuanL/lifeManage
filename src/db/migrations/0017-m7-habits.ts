import type { Migration } from "./types";

export const m7HabitsMigration: Migration = {
  id: "0017-m7-habits",
  statements: [
    `CREATE TABLE habits (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      intention TEXT NOT NULL DEFAULT '',
      weekly_target INTEGER NOT NULL CHECK (weekly_target BETWEEN 1 AND 7),
      stable_context TEXT NOT NULL DEFAULT '',
      trigger_condition TEXT NOT NULL DEFAULT '',
      obstacle TEXT NOT NULL DEFAULT '',
      adjustment TEXT NOT NULL DEFAULT '',
      start_on TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      privacy_level TEXT NOT NULL DEFAULT 'private'
        CHECK (privacy_level IN ('normal', 'private', 'highly_sensitive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_habits_active ON habits (archived, created_at)`,
    `CREATE TABLE habit_domain_links (
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE RESTRICT,
      PRIMARY KEY (habit_id, domain_id)
    )`,
    `CREATE INDEX idx_habit_domain_links_domain ON habit_domain_links (domain_id, habit_id)`,
    `CREATE TABLE habit_logs (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
      recorded_on TEXT NOT NULL,
      completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
      obstacle TEXT NOT NULL DEFAULT '',
      adjustment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (habit_id, recorded_on)
    )`,
    `CREATE INDEX idx_habit_logs_date ON habit_logs (habit_id, recorded_on DESC)`,
  ],
};
