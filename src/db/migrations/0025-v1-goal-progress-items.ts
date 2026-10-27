import type { Migration } from "./types";

export const v1GoalProgressItemsMigration: Migration = {
  id: "0025-v1-goal-progress-items",
  statements: [
    `CREATE TABLE goal_progress_items (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('key_result', 'milestone', 'outcome', 'exploration')),
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
      target_value REAL NOT NULL CHECK (target_value > 0 AND target_value <= 1000000000),
      current_value REAL NOT NULL CHECK (current_value >= 0 AND current_value <= 1000000000),
      weight REAL NOT NULL CHECK (weight > 0 AND weight <= 100),
      sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_goal_progress_items_goal ON goal_progress_items (goal_id, sort_order)`,
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
            WHERE goal_id = OLD.id),
          'progress_items', (SELECT json_group_array(json_object(
            'id', id, 'kind', kind, 'title', title, 'target_value', target_value,
            'current_value', current_value, 'weight', weight, 'sort_order', sort_order
          )) FROM goal_progress_items WHERE goal_id = OLD.id)
        ));
      END`,
  ],
};
