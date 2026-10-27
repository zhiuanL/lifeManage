import type { Migration } from "./types";

export const v1GoalDomainLinksMigration: Migration = {
  id: "0021-v1-goal-domain-links",
  statements: [
    `CREATE TABLE goal_domain_links (
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE CASCADE,
      PRIMARY KEY (goal_id, domain_id)
    )`,
    `CREATE INDEX idx_goal_domain_links_domain ON goal_domain_links (domain_id, goal_id)`,
    `INSERT INTO goal_domain_links (goal_id, domain_id)
      SELECT id, domain_id FROM goals WHERE domain_id IS NOT NULL`,
    `DROP TRIGGER goals_versions_before_update`,
    `CREATE TRIGGER goals_versions_before_update
      BEFORE UPDATE OF title, description, domain_id, status, target_date,
        sort_order, completed_at ON goals
      BEGIN
        INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
        VALUES ('goal', OLD.id, NEW.updated_at, json_object(
          'title', OLD.title, 'description', OLD.description, 'domain_id', OLD.domain_id,
          'status', OLD.status, 'target_date', OLD.target_date, 'sort_order', OLD.sort_order,
          'completed_at', OLD.completed_at, 'created_at', OLD.created_at,
          'updated_at', OLD.updated_at, 'privacy_level', OLD.privacy_level,
          'domain_ids', (SELECT json_group_array(domain_id) FROM goal_domain_links
            WHERE goal_id = OLD.id)
        ));
      END`,
  ],
};
