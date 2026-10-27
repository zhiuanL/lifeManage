import type { Migration } from "./types";
import { v1ReviewStructureMigration } from "./0043-v1-review-structure";

const history = v1ReviewStructureMigration.statements.find(statement =>
  statement.startsWith("CREATE TRIGGER reviews_versions_before_update"))!;

export const v1ReviewObjectLinksMigration: Migration = {
  id: "0044-v1-review-object-links",
  statements: [
    ...(["goal", "issue"] as const).flatMap(type => [
      `CREATE TABLE review_${type}_links (
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        ${type}_id TEXT NOT NULL REFERENCES ${type}s(id) ON DELETE RESTRICT,
        PRIMARY KEY (review_id, ${type}_id)
      )`,
      `CREATE INDEX idx_review_${type}_links_target ON review_${type}_links (${type}_id, review_id)`,
    ]),
    "DROP TRIGGER reviews_versions_before_update",
    history.replace("'domain_ids',", `'goal_ids', (SELECT json_group_array(goal_id) FROM (
            SELECT goal_id FROM review_goal_links WHERE review_id = OLD.id ORDER BY goal_id)),
          'issue_ids', (SELECT json_group_array(issue_id) FROM (
            SELECT issue_id FROM review_issue_links WHERE review_id = OLD.id ORDER BY issue_id)),
          'domain_ids',`),
  ],
};
