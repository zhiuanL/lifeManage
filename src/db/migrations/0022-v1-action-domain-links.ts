import type { Migration } from "./types";

export const v1ActionDomainLinksMigration: Migration = {
  id: "0022-v1-action-domain-links",
  statements: [
    `CREATE TABLE action_domain_links (
      action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE CASCADE,
      PRIMARY KEY (action_id, domain_id)
    )`,
    `CREATE INDEX idx_action_domain_links_domain ON action_domain_links (domain_id, action_id)`,
    `INSERT INTO action_domain_links (action_id, domain_id)
      SELECT id, domain_id FROM actions WHERE domain_id IS NOT NULL`,
  ],
};
