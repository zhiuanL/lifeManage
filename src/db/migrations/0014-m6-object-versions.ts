import type { Migration } from "./types";

const objects = [
  {
    table: "goals", type: "goal",
    fields: ["title", "description", "domain_id", "status", "target_date",
      "sort_order", "completed_at", "created_at", "updated_at", "privacy_level"],
  },
  {
    table: "reviews", type: "review",
    fields: ["title", "reflection", "insight", "next_focus", "domain_id",
      "reviewed_on", "created_at", "updated_at", "privacy_level"],
  },
  {
    table: "issues", type: "issue",
    fields: ["title", "description", "first_seen", "occurrence_count", "cause_hypothesis",
      "attempts", "follow_up", "status", "goal_id", "created_at", "updated_at", "privacy_level"],
    links: "issue_domain_links", linkId: "issue_id",
  },
  {
    table: "decisions", type: "decision",
    fields: ["title", "decided_on", "importance", "status", "background", "options",
      "constraints_text", "criteria", "risks", "opportunity_cost", "reversibility",
      "choice", "rationale", "execution_conditions", "outcome", "reflection",
      "goal_id", "created_at", "updated_at", "privacy_level"],
    links: "decision_domain_links", linkId: "decision_id",
  },
] as const;

export const m6ObjectVersionsMigration: Migration = {
  id: "0014-m6-object-versions",
  statements: [
    `CREATE TABLE object_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_type TEXT NOT NULL CHECK (object_type IN ('goal', 'review', 'issue', 'decision')),
      object_id TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
    )`,
    `CREATE INDEX idx_object_versions_lookup
      ON object_versions (object_type, object_id, id DESC)`,
    ...objects.map(({ table, type, fields, ...links }) => {
      const body = fields.flatMap((field) => [`'${field}'`, `OLD.${field}`]);
      if ("links" in links) {
        body.push("'domain_ids'", `(SELECT json_group_array(domain_id) FROM ${links.links}
          WHERE ${links.linkId} = OLD.id)`);
      }
      return `CREATE TRIGGER ${table}_versions_before_update
        BEFORE UPDATE OF ${fields.filter((field) =>
    field !== "updated_at" && field !== "privacy_level" && field !== "created_at").join(", ")}
        ON ${table}
        BEGIN
          INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
          VALUES ('${type}', OLD.id, NEW.updated_at, json_object(${body.join(", ")}));
        END`;
    }),
  ],
};
