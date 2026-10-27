import type { Migration } from "./types";

export const m4DecisionsMigration: Migration = {
  id: "0007-m4-decisions",
  statements: [
    `CREATE TABLE decisions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      decided_on TEXT NOT NULL,
      importance TEXT NOT NULL CHECK (importance IN ('ordinary', 'major')),
      status TEXT NOT NULL CHECK (status IN ('considering', 'decided')),
      background TEXT NOT NULL DEFAULT '',
      options TEXT NOT NULL DEFAULT '',
      constraints_text TEXT NOT NULL DEFAULT '',
      criteria TEXT NOT NULL DEFAULT '',
      risks TEXT NOT NULL DEFAULT '',
      opportunity_cost TEXT NOT NULL DEFAULT '',
      reversibility TEXT NOT NULL CHECK (reversibility IN ('unknown', 'reversible', 'difficult')),
      choice TEXT NOT NULL DEFAULT '',
      rationale TEXT NOT NULL DEFAULT '',
      execution_conditions TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      reflection TEXT NOT NULL DEFAULT '',
      goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (status <> 'decided' OR length(trim(choice)) > 0)
    )`,
    `CREATE INDEX idx_decisions_date ON decisions (decided_on DESC, created_at DESC)`,
    `CREATE INDEX idx_decisions_goal ON decisions (goal_id)`,
    `CREATE TABLE decision_domain_links (
      decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE CASCADE,
      PRIMARY KEY (decision_id, domain_id)
    )`,
    `CREATE INDEX idx_decision_domain_links_domain
     ON decision_domain_links (domain_id, decision_id)`,
    // Each view write and its domain links run in one SQLite statement.
    `CREATE VIEW decision_writes AS SELECT
      id, title, decided_on, importance, status, background, options, constraints_text,
      criteria, risks, opportunity_cost, reversibility, choice, rationale,
      execution_conditions, outcome, reflection, goal_id, created_at, updated_at,
      '[]' AS domain_ids_json FROM decisions`,
    `CREATE TRIGGER decision_writes_insert INSTEAD OF INSERT ON decision_writes BEGIN
      INSERT INTO decisions (id, title, decided_on, importance, status, background, options,
        constraints_text, criteria, risks, opportunity_cost, reversibility, choice, rationale,
        execution_conditions, outcome, reflection, goal_id, created_at, updated_at)
      VALUES (NEW.id, NEW.title, NEW.decided_on, NEW.importance, NEW.status, NEW.background,
        NEW.options, NEW.constraints_text, NEW.criteria, NEW.risks, NEW.opportunity_cost,
        NEW.reversibility, NEW.choice, NEW.rationale, NEW.execution_conditions, NEW.outcome,
        NEW.reflection, NEW.goal_id, NEW.created_at, NEW.updated_at);
      INSERT INTO decision_domain_links (decision_id, domain_id)
        SELECT NEW.id, value FROM json_each(NEW.domain_ids_json);
    END`,
    `CREATE TRIGGER decision_writes_update INSTEAD OF UPDATE ON decision_writes BEGIN
      UPDATE decisions SET title = NEW.title, decided_on = NEW.decided_on,
        importance = NEW.importance, status = NEW.status, background = NEW.background,
        options = NEW.options, constraints_text = NEW.constraints_text, criteria = NEW.criteria,
        risks = NEW.risks, opportunity_cost = NEW.opportunity_cost,
        reversibility = NEW.reversibility, choice = NEW.choice, rationale = NEW.rationale,
        execution_conditions = NEW.execution_conditions, outcome = NEW.outcome,
        reflection = NEW.reflection, goal_id = NEW.goal_id, updated_at = NEW.updated_at
      WHERE id = OLD.id AND (OLD.importance <> 'major' OR NEW.importance = 'major');
      SELECT RAISE(ABORT, 'Cannot downgrade a major decision')
        WHERE OLD.importance = 'major' AND NEW.importance <> 'major';
      INSERT OR IGNORE INTO decision_domain_links (decision_id, domain_id)
        SELECT OLD.id, value FROM json_each(NEW.domain_ids_json);
      DELETE FROM decision_domain_links WHERE decision_id = OLD.id
        AND domain_id NOT IN (SELECT value FROM json_each(NEW.domain_ids_json));
    END`,
    `CREATE TABLE inbox_items_m4_decisions (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      source TEXT NOT NULL CHECK (source IN ('quick-capture', 'inbox')),
      status TEXT NOT NULL CHECK (status IN ('unprocessed', 'processing', 'organized', 'archived')),
      target_type TEXT CHECK (target_type IN ('goal', 'action', 'review', 'issue', 'decision')),
      target_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (status IN ('unprocessed', 'archived') AND target_type IS NULL AND target_id IS NULL)
        OR (status IN ('processing', 'organized') AND target_type IS NOT NULL AND target_id IS NOT NULL)
      )
    )`,
    `INSERT INTO inbox_items_m4_decisions
     (id, content, source, status, target_type, target_id, created_at, updated_at)
     SELECT id, content, source, status, target_type, target_id, created_at, updated_at
     FROM inbox_items`,
    `DROP TABLE inbox_items`,
    `ALTER TABLE inbox_items_m4_decisions RENAME TO inbox_items`,
    `CREATE INDEX idx_inbox_items_status_created
     ON inbox_items (status, created_at DESC)`,
  ],
};
