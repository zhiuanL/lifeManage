import type { Migration } from "./types";
import { v1DecisionResourcesMigration } from "./0038-v1-decision-resources.ts";

export const v1ResourceOwnershipMigration: Migration = {
  id: "0039-v1-resource-ownership",
  statements: [
    "DROP TRIGGER decision_writes_insert",
    "DROP TRIGGER decision_writes_update",
    "DROP VIEW decision_writes",
    "DROP TRIGGER decisions_versions_before_update",
    "CREATE TEMP TABLE preserved_resource_links AS SELECT * FROM decision_resource_need_links",
    "DROP TABLE decision_resource_need_links",
    `CREATE TABLE resource_needs_next (
      id TEXT PRIMARY KEY,
      goal_id TEXT REFERENCES goals(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK (kind IN ('time', 'energy', 'skill', 'person', 'finance', 'tool')),
      description TEXT NOT NULL CHECK (length(trim(description)) > 0),
      skill_id TEXT REFERENCES skills(id) ON DELETE RESTRICT,
      person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
      met INTEGER NOT NULL DEFAULT 0 CHECK (met IN (0, 1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      decision_id TEXT REFERENCES decisions(id) ON DELETE RESTRICT,
      CHECK ((goal_id IS NOT NULL) != (decision_id IS NOT NULL))
    )`,
    `INSERT INTO resource_needs_next (id, goal_id, kind, description, skill_id, person_id, met, created_at, updated_at)
      SELECT id, goal_id, kind, description, skill_id, person_id, met, created_at, updated_at FROM resource_needs`,
    "DROP TABLE resource_needs",
    "ALTER TABLE resource_needs_next RENAME TO resource_needs",
    "CREATE INDEX idx_resource_needs_goal ON resource_needs (goal_id, met)",
    "CREATE INDEX idx_resource_needs_decision ON resource_needs (decision_id, met)",
    ...v1DecisionResourcesMigration.statements.filter((sql) =>
      sql.startsWith("CREATE TABLE decision_resource_need_links") ||
      sql.startsWith("CREATE INDEX decision_resource_need_lookup")),
    "INSERT INTO decision_resource_need_links SELECT * FROM preserved_resource_links",
    "DROP TABLE preserved_resource_links",
    ...v1DecisionResourcesMigration.statements.filter((sql) =>
      sql.startsWith("CREATE VIEW decision_writes") || sql.startsWith("CREATE TRIGGER")),
  ],
};
