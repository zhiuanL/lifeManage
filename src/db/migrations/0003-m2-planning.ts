import type { Migration } from "./types";

export const m2PlanningMigration: Migration = {
  id: "0003-m2-planning",
  statements: [
    `CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      description TEXT NOT NULL DEFAULT '',
      domain_id TEXT REFERENCES life_domains(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
      target_date TEXT,
      sort_order INTEGER NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_goals_status_sort_order
     ON goals (status, sort_order, created_at)`,
    `CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      notes TEXT NOT NULL DEFAULT '',
      domain_id TEXT REFERENCES life_domains(id) ON DELETE SET NULL,
      goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
      scheduled_for TEXT,
      sort_order INTEGER NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_actions_status_schedule
     ON actions (status, scheduled_for, sort_order, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_actions_goal_id
     ON actions (goal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_actions_domain_id
     ON actions (domain_id)`,
  ],
};
