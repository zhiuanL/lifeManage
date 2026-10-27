import type { Migration } from "./types";

export const m4InboxMigration: Migration = {
  id: "0005-m4-inbox",
  statements: [
    `CREATE TABLE IF NOT EXISTS inbox_items (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      source TEXT NOT NULL CHECK (source IN ('quick-capture', 'inbox')),
      status TEXT NOT NULL CHECK (status IN ('unprocessed', 'processing', 'organized', 'archived')),
      target_type TEXT CHECK (target_type IN ('goal', 'action', 'review')),
      target_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (status IN ('unprocessed', 'archived') AND target_type IS NULL AND target_id IS NULL)
        OR (status IN ('processing', 'organized') AND target_type IS NOT NULL AND target_id IS NOT NULL)
      )
    )`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_items_status_created
     ON inbox_items (status, created_at DESC)`,
  ],
};
