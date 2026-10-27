import type { Migration } from "./types";

export const v1InboxRecordTargetsMigration: Migration = {
  id: "0046-v1-inbox-record-targets",
  statements: [
    `CREATE TABLE inbox_items_v46 (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      source TEXT NOT NULL CHECK (source IN ('quick-capture', 'inbox')),
      status TEXT NOT NULL CHECK (status IN ('unprocessed', 'processing', 'organized', 'archived')),
      target_type TEXT CHECK (target_type IN ('goal', 'action', 'review', 'issue', 'decision', 'event', 'person')),
      target_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      privacy_level TEXT NOT NULL DEFAULT 'private'
        CHECK (privacy_level IN ('normal', 'private', 'highly_sensitive')),
      CHECK (
        (status IN ('unprocessed', 'archived') AND target_type IS NULL AND target_id IS NULL)
        OR (status IN ('processing', 'organized') AND target_type IS NOT NULL
          AND target_id IS NOT NULL AND length(trim(target_id)) > 0)
      )
    )`,
    `INSERT INTO inbox_items_v46
      (id, content, source, status, target_type, target_id, created_at, updated_at, privacy_level)
      SELECT id, content, source, status, target_type, target_id, created_at, updated_at, privacy_level
      FROM inbox_items`,
    `DROP TABLE inbox_items`,
    `ALTER TABLE inbox_items_v46 RENAME TO inbox_items`,
    `CREATE INDEX idx_inbox_items_status_created ON inbox_items (status, created_at DESC)`,
  ],
};
