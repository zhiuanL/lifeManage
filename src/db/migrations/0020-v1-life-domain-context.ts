import type { Migration } from "./types";

export const v1LifeDomainContextMigration: Migration = {
  id: "0020-v1-life-domain-context",
  statements: [
    `ALTER TABLE life_domains ADD COLUMN current_state TEXT NOT NULL DEFAULT ''
      CHECK (length(current_state) <= 500)`,
    `ALTER TABLE life_domains ADD COLUMN long_term_expectation TEXT NOT NULL DEFAULT ''
      CHECK (length(long_term_expectation) <= 500)`,
    `ALTER TABLE life_domains ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'paused', 'archived'))`,
  ],
};
