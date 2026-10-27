import type { Migration } from "./types";

export const m7ResourceAssessmentsMigration: Migration = {
  id: "0019-m7-resource-assessments",
  statements: [
    `CREATE TABLE resource_needs (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK (kind IN ('time', 'energy', 'skill', 'person', 'finance', 'tool')),
      description TEXT NOT NULL CHECK (length(trim(description)) > 0),
      skill_id TEXT REFERENCES skills(id) ON DELETE RESTRICT,
      person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
      met INTEGER NOT NULL DEFAULT 0 CHECK (met IN (0, 1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_resource_needs_goal ON resource_needs (goal_id, met)`,
    `CREATE TABLE system_assessments (
      id TEXT PRIMARY KEY,
      period_kind TEXT NOT NULL CHECK (period_kind IN ('month', 'quarter')),
      period_start TEXT NOT NULL,
      clarity TEXT NOT NULL DEFAULT '', alignment TEXT NOT NULL DEFAULT '',
      reviews TEXT NOT NULL DEFAULT '', decisions TEXT NOT NULL DEFAULT '',
      early_issues TEXT NOT NULL DEFAULT '', adjustment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (period_kind, period_start)
    )`,
  ],
};
