import type { Migration } from "./types";

export const v1ResourcePrivacyMigration: Migration = {
  id: "0040-v1-resource-privacy",
  statements: [
    "ALTER TABLE resource_needs ADD COLUMN privacy_level TEXT NOT NULL DEFAULT 'private' CHECK (privacy_level IN ('normal', 'private', 'highly_sensitive'))",
    `UPDATE resource_needs SET privacy_level = COALESCE(
      (SELECT privacy_level FROM goals WHERE goals.id = resource_needs.goal_id),
      (SELECT privacy_level FROM decisions WHERE decisions.id = resource_needs.decision_id),
      'private')`,
  ],
};
