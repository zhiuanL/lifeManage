import type { Migration } from "./types";

export const m5MetricPrivacyMigration: Migration = {
  id: "0013-m5-metric-privacy",
  statements: [
    `ALTER TABLE metric_definitions ADD COLUMN privacy_level TEXT NOT NULL
      DEFAULT 'private' CHECK (privacy_level IN ('normal', 'private', 'highly_sensitive'))`,
  ],
};
