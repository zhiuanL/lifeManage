import type { Migration } from "./types";

export const m7LifeRecordsMigration: Migration = {
  id: "0018-m7-life-records",
  statements: [
    `CREATE TABLE people (
      id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      relationship_type TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '',
      important_date TEXT, last_contact TEXT, shared_experiences TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      privacy_level TEXT NOT NULL DEFAULT 'private'
        CHECK (privacy_level IN ('normal', 'private', 'highly_sensitive')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE person_domain_links (
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE RESTRICT,
      PRIMARY KEY (person_id, domain_id)
    )`,
    `CREATE INDEX idx_person_domains ON person_domain_links (domain_id, person_id)`,
    `CREATE TABLE life_events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      happened_on TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
      goal_id TEXT REFERENCES goals(id) ON DELETE RESTRICT,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      privacy_level TEXT NOT NULL DEFAULT 'private'
        CHECK (privacy_level IN ('normal', 'private', 'highly_sensitive')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_events_date ON life_events (happened_on DESC)`,
    `CREATE TABLE event_domain_links (
      event_id TEXT NOT NULL REFERENCES life_events(id) ON DELETE RESTRICT,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE RESTRICT,
      PRIMARY KEY (event_id, domain_id)
    )`,
    `CREATE INDEX idx_event_domains ON event_domain_links (domain_id, event_id)`,
    `CREATE TABLE skills (
      id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      current_level INTEGER NOT NULL CHECK (current_level BETWEEN 0 AND 5),
      target_level INTEGER NOT NULL CHECK (target_level BETWEEN 0 AND 5),
      learning_path TEXT NOT NULL DEFAULT '', practice TEXT NOT NULL DEFAULT '',
      reflection TEXT NOT NULL DEFAULT '',
      goal_id TEXT REFERENCES goals(id) ON DELETE RESTRICT,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      privacy_level TEXT NOT NULL DEFAULT 'private'
        CHECK (privacy_level IN ('normal', 'private', 'highly_sensitive')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE skill_domain_links (
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE RESTRICT,
      PRIMARY KEY (skill_id, domain_id)
    )`,
    `CREATE INDEX idx_skill_domains ON skill_domain_links (domain_id, skill_id)`,
  ],
};
