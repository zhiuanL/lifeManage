import type { Migration } from "./types";
import { v1DecisionPeopleMigration } from "./0037-v1-decision-people.ts";

const insert = `INSERT OR IGNORE INTO decision_resource_need_links (decision_id, resource_need_id)
  SELECT NEW.id, value FROM json_each(NEW.resource_need_ids_json);`;
export const v1DecisionResourcesMigration: Migration = {
  id: "0038-v1-decision-resources",
  statements: [
    `CREATE TABLE decision_resource_need_links (
      decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
      resource_need_id TEXT NOT NULL REFERENCES resource_needs(id),
      PRIMARY KEY (decision_id, resource_need_id)
    )`,
    "CREATE INDEX decision_resource_need_lookup ON decision_resource_need_links (resource_need_id, decision_id)",
    "DROP TRIGGER decision_writes_insert",
    "DROP TRIGGER decision_writes_update",
    "DROP VIEW decision_writes",
    ...v1DecisionPeopleMigration.statements.filter((sql) =>
      sql.startsWith("CREATE VIEW decision_writes") || sql.startsWith("CREATE TRIGGER decision_writes"))
      .map((sql) => {
        if (sql.startsWith("CREATE VIEW")) return sql.replace(" AS person_ids_json",
          " AS person_ids_json, (SELECT json_group_array(resource_need_id) FROM decision_resource_need_links WHERE decision_id = decisions.id) AS resource_need_ids_json");
        const links = sql.includes("INSTEAD OF INSERT") ? insert : `${insert}
          DELETE FROM decision_resource_need_links WHERE decision_id = OLD.id
            AND resource_need_id NOT IN (SELECT value FROM json_each(NEW.resource_need_ids_json));`;
        return sql.replace(/END$/, `${links} END`);
      }),
    "DROP TRIGGER decisions_versions_before_update",
    v1DecisionPeopleMigration.statements.find((sql) =>
      sql.startsWith("CREATE TRIGGER decisions_versions_before_update"))!
      .replace("'domain_ids',", "'resource_need_ids', (SELECT json_group_array(resource_need_id) FROM decision_resource_need_links WHERE decision_id = OLD.id), 'domain_ids',"),
  ],
};


