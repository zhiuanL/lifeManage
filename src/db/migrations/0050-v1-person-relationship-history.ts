import type { Migration } from "./types";

export const v1PersonRelationshipHistoryMigration: Migration = {
  id: "0050-v1-person-relationship-history",
  statements: [
    `CREATE TABLE person_relationship_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id TEXT NOT NULL REFERENCES people(id),
      changed_at TEXT NOT NULL,
      before_json TEXT NOT NULL CHECK (json_valid(before_json)),
      after_json TEXT NOT NULL CHECK (json_valid(after_json))
    )`,
    `CREATE INDEX idx_person_relationship_versions_person
      ON person_relationship_versions (person_id, id)`,
  ],
};
