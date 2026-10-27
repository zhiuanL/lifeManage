import type { Migration } from "./types";

export const m5PrivacyMigration: Migration = {
  id: "0008-m5-privacy",
  statements: [
    ...["life_domains", "goals", "actions", "reviews", "inbox_items", "issues", "decisions"]
      .map((table) => `ALTER TABLE ${table} ADD COLUMN privacy_level TEXT NOT NULL
        DEFAULT 'private' CHECK (privacy_level IN ('normal', 'private', 'highly_sensitive'))`),
  ],
};
