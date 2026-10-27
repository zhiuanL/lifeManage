import type { Migration } from "./types";

export const v1ActionDetailsMigration: Migration = {
  id: "0041-v1-action-details",
  statements: [
    `ALTER TABLE actions ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'
      CHECK (json_valid(details_json) AND json_type(details_json) = 'object')`,
  ],
};
