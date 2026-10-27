import type { Migration } from "./types";

export const v1GoalRelationsMigration: Migration = {
  id: "0031-v1-goal-relations",
  statements: [
    `CREATE TABLE goal_relations (
      goal_id TEXT NOT NULL REFERENCES goals(id),
      target_goal_id TEXT NOT NULL REFERENCES goals(id),
      relation_type TEXT NOT NULL CHECK (relation_type IN ('support', 'depend', 'conflict', 'related')),
      PRIMARY KEY (goal_id, target_goal_id, relation_type),
      CHECK (goal_id <> target_goal_id)
    )`,
    `CREATE UNIQUE INDEX goal_relations_symmetric_unique ON goal_relations (
      MIN(goal_id, target_goal_id), MAX(goal_id, target_goal_id), relation_type
    ) WHERE relation_type IN ('conflict', 'related')`,
    `CREATE INDEX goal_relations_target ON goal_relations(target_goal_id)`,
    `DROP TRIGGER goals_versions_before_update`,
    `CREATE TRIGGER goals_versions_before_update
      BEFORE UPDATE OF title, description, domain_id, status, target_date,
        sort_order, completed_at, parent_id, lifecycle_status, status_reason, archived_at, progress_mode, progress_weight, priority ON goals
      BEGIN
        INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
        VALUES ('goal', OLD.id, NEW.updated_at, json_object(
          'title', OLD.title, 'description', OLD.description, 'domain_id', OLD.domain_id,
          'status', COALESCE(OLD.lifecycle_status, OLD.status),
          'status_reason', OLD.status_reason, 'archived_at', OLD.archived_at,
          'relations', (SELECT json_group_array(json_object(
            'target_goal_id', target_goal_id, 'relation_type', relation_type
          )) FROM (SELECT * FROM goal_relations WHERE goal_id = OLD.id ORDER BY target_goal_id, relation_type)),
          'priority', OLD.priority, 'progress_mode', OLD.progress_mode, 'progress_weight', OLD.progress_weight,
          'habit_progress', (SELECT json_group_array(json_object(
            'habit_id', habit_id, 'start_on', start_on, 'end_on', end_on,
            'weekly_target', weekly_target, 'weight', weight, 'sort_order', sort_order
          )) FROM (SELECT * FROM goal_habit_progress WHERE goal_id = OLD.id ORDER BY sort_order)),
          'target_date', OLD.target_date, 'sort_order', OLD.sort_order,
          'completed_at', OLD.completed_at, 'created_at', OLD.created_at,
          'updated_at', OLD.updated_at, 'privacy_level', OLD.privacy_level,
          'parent_id', OLD.parent_id,
          'domain_ids', (SELECT json_group_array(domain_id) FROM goal_domain_links WHERE goal_id = OLD.id),
          'progress_items', (SELECT json_group_array(json_object(
            'id', id, 'kind', kind, 'title', title, 'target_value', target_value,
            'current_value', current_value, 'weight', weight, 'sort_order', sort_order
          )) FROM goal_progress_items WHERE goal_id = OLD.id)
        ));
      END`,
  ],
};
