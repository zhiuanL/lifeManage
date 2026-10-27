import type { Migration } from "./types";
import { v1DecisionNavigationMigration } from "./0036-v1-decision-navigation.ts";

const insert = `INSERT OR IGNORE INTO decision_person_links (decision_id, person_id)
  SELECT NEW.id, value FROM json_each(NEW.person_ids_json);`;
export const v1DecisionPeopleMigration: Migration = {
  id: "0037-v1-decision-people",
  statements: [
    `CREATE TABLE decision_person_links (
      decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id),
      PRIMARY KEY (decision_id, person_id)
    )`,
    "CREATE INDEX decision_person_lookup ON decision_person_links (person_id, decision_id)",
    "DROP TRIGGER decision_writes_insert",
    "DROP TRIGGER decision_writes_update",
    "DROP VIEW decision_writes",
    ...v1DecisionNavigationMigration.statements.filter((sql) =>
      sql.startsWith("CREATE VIEW decision_writes") || sql.startsWith("CREATE TRIGGER decision_writes"))
      .map((sql) => {
        if (sql.startsWith("CREATE VIEW")) return sql.replace(" AS navigation_ids_json",
          " AS navigation_ids_json, (SELECT json_group_array(person_id) FROM decision_person_links WHERE decision_id = decisions.id) AS person_ids_json");
        const links = sql.includes("INSTEAD OF INSERT") ? insert : `${insert}
          DELETE FROM decision_person_links WHERE decision_id = OLD.id
            AND person_id NOT IN (SELECT value FROM json_each(NEW.person_ids_json));`;
        return sql.replace(/END$/, `${links} END`);
      }),
    "DROP TRIGGER decisions_versions_before_update",
    v1DecisionNavigationMigration.statements.find((sql) =>
      sql.startsWith("CREATE TRIGGER decisions_versions_before_update"))!
      .replace("'domain_ids',", "'person_ids', (SELECT json_group_array(person_id) FROM decision_person_links WHERE decision_id = OLD.id), 'domain_ids',"),
  ],
};

