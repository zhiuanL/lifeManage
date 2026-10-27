import type { Migration } from "./types";

export const v1GoalLifecycleMigration: Migration = {
  id: "0026-v1-goal-lifecycle",
  statements: [
    `ALTER TABLE goals ADD COLUMN lifecycle_status TEXT CHECK (
      lifecycle_status IS NULL OR
      (lifecycle_status = 'candidate' AND status = 'active') OR
      (lifecycle_status = 'abandoned' AND status = 'paused') OR
      (lifecycle_status = 'archived' AND status IN ('active', 'completed'))
    )`,
    `ALTER TABLE goals ADD COLUMN status_reason TEXT CHECK (
      (status_reason IS NULL OR length(trim(status_reason)) BETWEEN 1 AND 600) AND
      (lifecycle_status IS NOT 'abandoned' OR status_reason IS NOT NULL)
    )`,
    `ALTER TABLE goals ADD COLUMN archived_at TEXT CHECK (
      (lifecycle_status IS 'archived' AND archived_at IS NOT NULL) OR
      (lifecycle_status IS NOT 'archived' AND archived_at IS NULL)
    )`,
    `DROP TRIGGER goals_versions_before_update`,
    `CREATE TRIGGER goals_versions_before_update
      BEFORE UPDATE OF title, description, domain_id, status, target_date,
        sort_order, completed_at, parent_id, lifecycle_status, status_reason, archived_at ON goals
      BEGIN
        INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
        VALUES ('goal', OLD.id, NEW.updated_at, json_object(
          'title', OLD.title, 'description', OLD.description, 'domain_id', OLD.domain_id,
          'status', COALESCE(OLD.lifecycle_status, OLD.status),
          'status_reason', OLD.status_reason, 'archived_at', OLD.archived_at,
          'target_date', OLD.target_date, 'sort_order', OLD.sort_order,
          'completed_at', OLD.completed_at, 'created_at', OLD.created_at,
          'updated_at', OLD.updated_at, 'privacy_level', OLD.privacy_level,
          'parent_id', OLD.parent_id,
          'domain_ids', (SELECT json_group_array(domain_id) FROM goal_domain_links
            WHERE goal_id = OLD.id),
          'progress_items', (SELECT json_group_array(json_object(
            'id', id, 'kind', kind, 'title', title, 'target_value', target_value,
            'current_value', current_value, 'weight', weight, 'sort_order', sort_order
          )) FROM goal_progress_items WHERE goal_id = OLD.id)
        ));
      END`,
  ],
};
