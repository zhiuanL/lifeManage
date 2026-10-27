import type { Migration } from "./types";

const fields = ["name", "description", "focus", "color_key", "icon_key",
  "current_state", "long_term_expectation", "status"] as const;
const snapshot = (prefix: "OLD" | "NEW") =>
  `json_object(${fields.map(field => `'${field}', ${prefix}.${field}`).join(", ")})`;

export const v1DomainHistoryMigration: Migration = {
  id: "0048-v1-domain-history",
  statements: [
    `CREATE TABLE life_domain_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE RESTRICT,
      changed_at TEXT NOT NULL,
      before_json TEXT NOT NULL CHECK (json_valid(before_json)),
      after_json TEXT NOT NULL CHECK (json_valid(after_json))
    )`,
    `CREATE INDEX idx_life_domain_versions_domain ON life_domain_versions (domain_id, id)`,
    `CREATE TRIGGER life_domains_after_change AFTER UPDATE ON life_domains
      WHEN ${fields.map(field => `OLD.${field} IS NOT NEW.${field}`).join(" OR ")}
      BEGIN
        INSERT INTO life_domain_versions (domain_id, changed_at, before_json, after_json)
        VALUES (NEW.id, NEW.updated_at, ${snapshot("OLD")}, ${snapshot("NEW")});
      END`,
  ],
};
