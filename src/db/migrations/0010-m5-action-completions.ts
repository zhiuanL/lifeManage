import type { Migration } from "./types";

export const m5ActionCompletionsMigration: Migration = {
  id: "0010-m5-action-completions",
  statements: [
    // Previous completions cannot be reconstructed from the current action date.
    `CREATE TABLE action_completion_plans (
      action_id TEXT PRIMARY KEY REFERENCES actions(id) ON DELETE RESTRICT,
      completed_at TEXT NOT NULL,
      planned_date TEXT
    )`,
    `CREATE TRIGGER action_completion_initial AFTER INSERT ON actions
      WHEN NEW.status = 'completed' BEGIN
      INSERT INTO action_completion_plans (action_id, completed_at, planned_date)
      VALUES (NEW.id, NEW.completed_at, NEW.scheduled_for);
    END`,
    `CREATE TRIGGER action_completion_record AFTER UPDATE ON actions
      WHEN OLD.status IS NOT 'completed' AND NEW.status = 'completed' BEGIN
      INSERT INTO action_completion_plans (action_id, completed_at, planned_date)
      VALUES (NEW.id, NEW.completed_at, NEW.scheduled_for)
      ON CONFLICT(action_id) DO UPDATE SET
        completed_at = excluded.completed_at, planned_date = excluded.planned_date;
    END`,
  ],
};
