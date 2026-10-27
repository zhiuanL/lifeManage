import type { Migration } from "./types";
import { m4DecisionsMigration } from "./0007-m4-decisions.ts";
import { m6ObjectVersionsMigration } from "./0014-m6-object-versions.ts";

const navigationInsert = `INSERT OR IGNORE INTO decision_navigation_links (decision_id, navigation_id)
  SELECT NEW.id, value FROM json_each(NEW.navigation_ids_json);`;
const writeStatements = m4DecisionsMigration.statements.filter((sql) =>
  sql.startsWith("CREATE VIEW decision_writes") || sql.startsWith("CREATE TRIGGER decision_writes"));
const history = m6ObjectVersionsMigration.statements.find((sql) =>
  sql.startsWith("CREATE TRIGGER decisions_versions_before_update"))!;

export const v1DecisionNavigationMigration: Migration = {
  id: "0036-v1-decision-navigation",
  statements: [
    `CREATE TABLE decision_navigation_links (
      decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
      navigation_id TEXT NOT NULL REFERENCES life_navigation(id),
      PRIMARY KEY (decision_id, navigation_id)
    )`,
    `CREATE INDEX decision_navigation_lookup ON decision_navigation_links (navigation_id, decision_id)`,
    "DROP TRIGGER decision_writes_insert",
    "DROP TRIGGER decision_writes_update",
    "DROP VIEW decision_writes",
    ...writeStatements.map((sql) => {
      if (sql.startsWith("CREATE VIEW")) return sql.replace("'[]' AS domain_ids_json",
        "'[]' AS domain_ids_json, (SELECT json_group_array(navigation_id) FROM decision_navigation_links WHERE decision_id = decisions.id) AS navigation_ids_json");
      const links = sql.includes("INSTEAD OF INSERT") ? navigationInsert : `${navigationInsert}
        DELETE FROM decision_navigation_links WHERE decision_id = OLD.id
          AND navigation_id NOT IN (SELECT value FROM json_each(NEW.navigation_ids_json));`;
      return sql.replace(/END$/, `${links}
    END`);
    }),
    "DROP TRIGGER decisions_versions_before_update",
    history.replace("'domain_ids',", "'navigation_ids', (SELECT json_group_array(navigation_id) FROM decision_navigation_links WHERE decision_id = OLD.id), 'domain_ids',"),
  ],
};

