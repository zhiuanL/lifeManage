import { m6ObjectVersionsMigration } from "./0014-m6-object-versions.ts";
import { v1ReviewDomainLinksMigration } from "./0023-v1-review-domain-links.ts";
import { v1GoalDirectionMigration } from "./0033-v1-goal-direction.ts";
import type { Migration } from "./types";

export const v1NavigationHistoryMigration: Migration = {
  id: "0034-v1-navigation-history",
  statements: [
    ...["goals", "reviews", "issues", "decisions"].map(table =>
      `DROP TRIGGER ${table}_versions_before_update`),
    `CREATE TABLE object_versions_v34 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_type TEXT NOT NULL CHECK (object_type IN ('goal', 'review', 'issue', 'decision', 'navigation')),
      object_id TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
    )`,
    `INSERT INTO object_versions_v34 SELECT * FROM object_versions ORDER BY id`,
    // Keep the high-water mark even when the newest history rows were removed.
    `UPDATE sqlite_sequence SET seq = max(seq, COALESCE(
      (SELECT seq FROM sqlite_sequence WHERE name = 'object_versions'), 0))
      WHERE name = 'object_versions_v34'`,
    `DROP TABLE object_versions`,
    `ALTER TABLE object_versions_v34 RENAME TO object_versions`,
    `CREATE INDEX idx_object_versions_lookup ON object_versions (object_type, object_id, id DESC)`,
    ...m6ObjectVersionsMigration.statements.filter(statement =>
      statement.startsWith("CREATE TRIGGER issues_") || statement.startsWith("CREATE TRIGGER decisions_")),
    ...v1ReviewDomainLinksMigration.statements.filter(statement => statement.startsWith("CREATE TRIGGER")),
    ...v1GoalDirectionMigration.statements.filter(statement => statement.startsWith("CREATE TRIGGER")),
    `CREATE TRIGGER life_navigation_versions_before_update
      BEFORE UPDATE OF kind, title, description, archived_at ON life_navigation
      WHEN OLD.kind IS NOT NEW.kind OR OLD.title IS NOT NEW.title
        OR OLD.description IS NOT NEW.description OR OLD.archived_at IS NOT NEW.archived_at
      BEGIN
        INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
        VALUES ('navigation', OLD.id, NEW.updated_at, json_object(
          'kind', OLD.kind, 'title', OLD.title, 'description', OLD.description,
          'archived_at', OLD.archived_at, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at
        ));
      END`,
  ],
};
