import type { Migration } from "./types";

export const v1NavigationPrivacyMigration: Migration = {
  id: "0035-v1-navigation-privacy",
  statements: [
    "ALTER TABLE life_navigation ADD COLUMN privacy_level TEXT NOT NULL DEFAULT 'private' CHECK (privacy_level IN ('normal', 'private', 'highly_sensitive'))",
  ],
};

