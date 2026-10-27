import type { Migration } from "./types";

export const v1HabitGoalProgressMigration: Migration = {
  id: "0028-v1-habit-goal-progress",
  statements: [
    `CREATE TABLE goal_habit_progress (
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
      start_on TEXT NOT NULL CHECK (length(start_on) = 10 AND start_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(start_on, '+0 days') IS start_on),
      end_on TEXT NOT NULL CHECK (length(end_on) = 10 AND end_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(end_on, '+0 days') IS end_on AND end_on >= start_on),
      weekly_target INTEGER NOT NULL CHECK (typeof(weekly_target) = 'integer' AND weekly_target BETWEEN 1 AND 7),
      weight REAL NOT NULL CHECK (weight > 0 AND weight <= 100),
      sort_order INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer' AND sort_order >= 0),
      PRIMARY KEY (goal_id, habit_id)
    )`,
    `CREATE TRIGGER goal_habit_progress_before_insert BEFORE INSERT ON goal_habit_progress
      WHEN (SELECT progress_mode FROM goals WHERE id = NEW.goal_id) != 'automatic'
        OR (SELECT count(*) FROM goal_habit_progress WHERE goal_id = NEW.goal_id) >= 30
      BEGIN SELECT RAISE(ABORT, 'Invalid habit goal settings'); END`,
    `DROP TRIGGER goals_versions_before_update`,
    `CREATE TRIGGER goals_versions_before_update
      BEFORE UPDATE OF title, description, domain_id, status, target_date,
        sort_order, completed_at, parent_id, lifecycle_status, status_reason, archived_at, progress_mode ON goals
      BEGIN
        INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
        VALUES ('goal', OLD.id, NEW.updated_at, json_object(
          'title', OLD.title, 'description', OLD.description, 'domain_id', OLD.domain_id,
          'status', COALESCE(OLD.lifecycle_status, OLD.status),
          'status_reason', OLD.status_reason, 'archived_at', OLD.archived_at,
          'progress_mode', OLD.progress_mode,
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
