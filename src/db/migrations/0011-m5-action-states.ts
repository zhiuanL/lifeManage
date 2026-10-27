import type { Migration } from "./types";

export const m5ActionStatesMigration: Migration = {
  id: "0011-m5-action-states",
  statements: [
    `CREATE TABLE action_state_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE RESTRICT,
      before_status TEXT CHECK (before_status IN ('open', 'completed')),
      after_status TEXT NOT NULL CHECK (after_status IN ('open', 'completed')),
      scheduled_for TEXT,
      changed_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_action_state_events_action
     ON action_state_events (action_id, changed_at, id)`,
    // Only post-migration creations establish a complete status baseline.
    `CREATE TRIGGER action_status_initial AFTER INSERT ON actions BEGIN
      INSERT INTO action_state_events
        (action_id, before_status, after_status, scheduled_for, changed_at)
      VALUES (NEW.id, NULL, NEW.status, NEW.scheduled_for, NEW.created_at);
    END`,
    `CREATE TRIGGER action_state_record AFTER UPDATE ON actions
      WHEN OLD.status IS NOT NEW.status OR OLD.scheduled_for IS NOT NEW.scheduled_for BEGIN
      INSERT INTO action_state_events
        (action_id, before_status, after_status, scheduled_for, changed_at)
      VALUES (NEW.id, OLD.status, NEW.status, NEW.scheduled_for, NEW.updated_at);
    END`,
  ],
};
