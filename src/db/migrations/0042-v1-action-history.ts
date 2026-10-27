import { m6ObjectVersionsMigration } from "./0014-m6-object-versions.ts";
import { v1ReviewDomainLinksMigration } from "./0023-v1-review-domain-links.ts";
import { v1GoalDirectionMigration } from "./0033-v1-goal-direction.ts";
import { v1NavigationHistoryMigration } from "./0034-v1-navigation-history.ts";
import { v1ResourceOwnershipMigration } from "./0039-v1-resource-ownership.ts";
import { actionDetailFields } from "../../domain/planning/ActionDetails.ts";
import type { Migration } from "./types";

export const v1ActionHistoryMigration: Migration = {
  id: "0042-v1-action-history",
  statements: [
    ...["goals", "reviews", "issues", "decisions", "life_navigation"].map(table =>
      `DROP TRIGGER ${table}_versions_before_update`),
    `CREATE TABLE object_versions_v42 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_type TEXT NOT NULL CHECK (object_type IN ('goal', 'review', 'issue', 'decision', 'navigation', 'action')),
      object_id TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
    )`,
    "INSERT INTO object_versions_v42 SELECT * FROM object_versions ORDER BY id",
    // Preserve identifiers even if the newest old history was removed.
    `UPDATE sqlite_sequence SET seq = max(seq, COALESCE(
      (SELECT seq FROM sqlite_sequence WHERE name = 'object_versions'), 0))
      WHERE name = 'object_versions_v42'`,
    "DROP TABLE object_versions",
    "ALTER TABLE object_versions_v42 RENAME TO object_versions",
    "CREATE INDEX idx_object_versions_lookup ON object_versions (object_type, object_id, id DESC)",
    ...m6ObjectVersionsMigration.statements.filter(s => s.startsWith("CREATE TRIGGER issues_")),
    ...v1ResourceOwnershipMigration.statements.filter(s => s.startsWith("CREATE TRIGGER decisions_versions_before_update")),
    ...v1ReviewDomainLinksMigration.statements.filter(s => s.startsWith("CREATE TRIGGER")),
    ...v1GoalDirectionMigration.statements.filter(s => s.startsWith("CREATE TRIGGER")),
    ...v1NavigationHistoryMigration.statements.filter(s => s.startsWith("CREATE TRIGGER life_navigation_")),
    `CREATE TRIGGER actions_versions_before_update
      BEFORE UPDATE OF details_json ON actions
      WHEN ${[...actionDetailFields.map(([key]) => key), "actualMinutes"].map(key =>
        `COALESCE(json_extract(OLD.details_json, '$.${key}'), ${key === "actualMinutes" ? "NULL" : "''"}) IS NOT COALESCE(json_extract(NEW.details_json, '$.${key}'), ${key === "actualMinutes" ? "NULL" : "''"})`).join(" OR ")}
      BEGIN
        INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
        VALUES ('action', OLD.id, NEW.updated_at, json_object(
          'title', OLD.title, 'status', OLD.status, 'scheduled_for', OLD.scheduled_for,
          'completed_at', OLD.completed_at, 'details_json', OLD.details_json,
          'created_at', OLD.created_at, 'updated_at', OLD.updated_at
        ));
      END`,
  ],
};

