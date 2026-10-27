import type { Migration } from "./types";

export const m5DomainMetricsMigration: Migration = {
  id: "0012-m5-domain-metrics",
  statements: [
    `CREATE TABLE metric_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE metric_domain_links (
      metric_id TEXT NOT NULL REFERENCES metric_definitions(id) ON DELETE RESTRICT,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE RESTRICT,
      PRIMARY KEY (metric_id, domain_id)
    )`,
    `CREATE INDEX idx_metric_domain_links_domain ON metric_domain_links (domain_id, metric_id)`,
    `CREATE TABLE metric_records (
      id TEXT PRIMARY KEY,
      metric_id TEXT NOT NULL REFERENCES metric_definitions(id) ON DELETE RESTRICT,
      recorded_on TEXT NOT NULL,
      value REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (metric_id, recorded_on)
    )`,
    `CREATE INDEX idx_metric_records_date ON metric_records (metric_id, recorded_on)`,
  ],
};
