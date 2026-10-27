import type { Migration } from "./types";

export const m5ActionPlansMigration: Migration = {
  id: "0009-m5-action-plans",
  statements: [
    `CREATE TABLE action_plan_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE RESTRICT,
      before_date TEXT,
      after_date TEXT,
      reason_code TEXT NOT NULL CHECK (reason_code IN
        ('initial', 'personal', 'external', 'conflict', 'other')),
      note TEXT NOT NULL DEFAULT '',
      changed_at TEXT NOT NULL,
      completed_at_at_change TEXT,
      domain_id TEXT,
      goal_id TEXT
    )`,
    `CREATE INDEX idx_action_plan_changes_action
     ON action_plan_changes (action_id, changed_at, id)`,
    // Only actions created after this migration receive an initial plan; old plans are unknown.
    `CREATE TRIGGER action_plan_initial AFTER INSERT ON actions BEGIN
      INSERT INTO action_plan_changes
        (action_id, before_date, after_date, reason_code, note, changed_at,
         completed_at_at_change, domain_id, goal_id)
      VALUES (NEW.id, NULL, NEW.scheduled_for, 'initial', '', NEW.created_at,
        NEW.completed_at, NEW.domain_id, NEW.goal_id);
    END`,
    // A view write keeps the action edit and the reasoned plan event in one SQLite statement.
    `CREATE VIEW action_plan_writes AS SELECT
      id, title, notes, domain_id, goal_id, status, scheduled_for,
      completed_at, updated_at, '' AS reason_code, '' AS reason_note FROM actions`,
    `CREATE TRIGGER action_plan_writes_update INSTEAD OF UPDATE ON action_plan_writes BEGIN
      SELECT RAISE(ABORT, 'Schedule change requires a reason')
        WHERE OLD.scheduled_for IS NOT NEW.scheduled_for
          AND (NEW.reason_code NOT IN ('personal', 'external', 'conflict', 'other')
            OR length(NEW.reason_note) > 500);
      UPDATE actions SET title = NEW.title, notes = NEW.notes, domain_id = NEW.domain_id,
        goal_id = NEW.goal_id, status = NEW.status, scheduled_for = NEW.scheduled_for,
        completed_at = NEW.completed_at, updated_at = NEW.updated_at
        WHERE id = OLD.id;
      INSERT INTO action_plan_changes
        (action_id, before_date, after_date, reason_code, note, changed_at,
         completed_at_at_change, domain_id, goal_id)
      SELECT OLD.id, OLD.scheduled_for, NEW.scheduled_for, NEW.reason_code,
        NEW.reason_note, NEW.updated_at, NEW.completed_at, NEW.domain_id, NEW.goal_id
        WHERE OLD.scheduled_for IS NOT NEW.scheduled_for;
    END`,
  ],
};
