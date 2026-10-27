import type { Migration } from "./types";

export const v1DomainSatisfactionMigration: Migration = {
  id: "0051-v1-domain-satisfaction",
  statements: [
    `CREATE TABLE domain_satisfaction_links (
      domain_id TEXT PRIMARY KEY NOT NULL REFERENCES life_domains(id) ON DELETE RESTRICT,
      metric_id TEXT NOT NULL REFERENCES metric_definitions(id) ON DELETE RESTRICT,
      FOREIGN KEY (metric_id, domain_id)
        REFERENCES metric_domain_links(metric_id, domain_id) ON DELETE RESTRICT
    )`,
  ],
};
