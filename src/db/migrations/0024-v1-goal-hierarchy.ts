import type { Migration } from "./types";

export const v1GoalHierarchyMigration: Migration = {
  id: "0024-v1-goal-hierarchy",
  statements: [
    `ALTER TABLE goals ADD COLUMN parent_id TEXT
      REFERENCES goals(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
      CHECK (parent_id IS NULL OR parent_id != id)`,
    `CREATE INDEX idx_goals_parent_id ON goals (parent_id)`,
    `DROP TRIGGER goals_versions_before_update`,
    `CREATE TRIGGER goals_versions_before_update
      BEFORE UPDATE OF title, description, domain_id, status, target_date,
        sort_order, completed_at, parent_id ON goals
      BEGIN
        INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
        VALUES ('goal', OLD.id, NEW.updated_at, json_object(
          'title', OLD.title, 'description', OLD.description, 'domain_id', OLD.domain_id,
          'status', OLD.status, 'target_date', OLD.target_date, 'sort_order', OLD.sort_order,
          'completed_at', OLD.completed_at, 'created_at', OLD.created_at,
          'updated_at', OLD.updated_at, 'privacy_level', OLD.privacy_level,
          'parent_id', OLD.parent_id,
          'domain_ids', (SELECT json_group_array(domain_id) FROM goal_domain_links
            WHERE goal_id = OLD.id)
        ));
      END`,
  ],
};
