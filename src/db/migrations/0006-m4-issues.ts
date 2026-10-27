import type { Migration } from "./types";

export const m4IssuesMigration: Migration = {
  id: "0006-m4-issues",
  statements: [
    `CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      description TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count BETWEEN 1 AND 999999),
      cause_hypothesis TEXT NOT NULL DEFAULT '',
      attempts TEXT NOT NULL DEFAULT '',
      follow_up TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('open', 'watching', 'resolved')),
      goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_issues_status_first_seen
     ON issues (status, first_seen DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_issues_goal_id ON issues (goal_id)`,
    `CREATE TABLE IF NOT EXISTS issue_domain_links (
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE CASCADE,
      PRIMARY KEY (issue_id, domain_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_issue_domain_links_domain
     ON issue_domain_links (domain_id, issue_id)`,
    // The SQL plugin exposes individual execute calls, so this view makes each issue/link edit atomic.
    `CREATE VIEW IF NOT EXISTS issue_writes AS
     SELECT id, title, description, first_seen, occurrence_count, cause_hypothesis,
            attempts, follow_up, status, goal_id, created_at, updated_at,
            '[]' AS domain_ids_json FROM issues`,
    `CREATE TRIGGER IF NOT EXISTS issue_writes_insert INSTEAD OF INSERT ON issue_writes
     BEGIN
       INSERT INTO issues (id, title, description, first_seen, occurrence_count,
         cause_hypothesis, attempts, follow_up, status, goal_id, created_at, updated_at)
       VALUES (NEW.id, NEW.title, NEW.description, NEW.first_seen, NEW.occurrence_count,
         NEW.cause_hypothesis, NEW.attempts, NEW.follow_up, NEW.status, NEW.goal_id,
         NEW.created_at, NEW.updated_at);
       INSERT INTO issue_domain_links (issue_id, domain_id)
         SELECT NEW.id, value FROM json_each(NEW.domain_ids_json);
     END`,
    `CREATE TRIGGER IF NOT EXISTS issue_writes_update INSTEAD OF UPDATE ON issue_writes
     BEGIN
       UPDATE issues SET title = NEW.title, description = NEW.description,
         first_seen = NEW.first_seen, occurrence_count = NEW.occurrence_count,
         cause_hypothesis = NEW.cause_hypothesis, attempts = NEW.attempts,
         follow_up = NEW.follow_up, status = NEW.status, goal_id = NEW.goal_id,
         updated_at = NEW.updated_at WHERE id = OLD.id;
       INSERT OR IGNORE INTO issue_domain_links (issue_id, domain_id)
         SELECT OLD.id, value FROM json_each(NEW.domain_ids_json);
       DELETE FROM issue_domain_links WHERE issue_id = OLD.id
         AND domain_id NOT IN (SELECT value FROM json_each(NEW.domain_ids_json));
     END`,
    `CREATE TABLE inbox_items_m4_issues (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      source TEXT NOT NULL CHECK (source IN ('quick-capture', 'inbox')),
      status TEXT NOT NULL CHECK (status IN ('unprocessed', 'processing', 'organized', 'archived')),
      target_type TEXT CHECK (target_type IN ('goal', 'action', 'review', 'issue')),
      target_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (status IN ('unprocessed', 'archived') AND target_type IS NULL AND target_id IS NULL)
        OR (status IN ('processing', 'organized') AND target_type IS NOT NULL AND target_id IS NOT NULL)
      )
    )`,
    `INSERT INTO inbox_items_m4_issues
     (id, content, source, status, target_type, target_id, created_at, updated_at)
     SELECT id, content, source, status, target_type, target_id, created_at, updated_at
     FROM inbox_items`,
    `DROP TABLE inbox_items`,
    `ALTER TABLE inbox_items_m4_issues RENAME TO inbox_items`,
    `CREATE INDEX idx_inbox_items_status_created
     ON inbox_items (status, created_at DESC)`,
  ],
};
