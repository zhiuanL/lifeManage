import type { Migration } from "./types";

export const v1PersonDatesMigration: Migration = {
  id: "0049-v1-person-dates",
  statements: [
    `CREATE TABLE person_dates (
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer' AND sort_order BETWEEN 0 AND 20),
      kind TEXT NOT NULL CHECK (kind IN ('birthday', 'important')),
      label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
      happened_on TEXT NOT NULL CHECK (length(happened_on) = 10),
      PRIMARY KEY (person_id, sort_order),
      UNIQUE (person_id, kind, label, happened_on),
      CHECK (kind != 'birthday' OR label = '生日')
    )`,
    `CREATE UNIQUE INDEX idx_person_dates_birthday ON person_dates (person_id)
      WHERE kind = 'birthday'`,
  ],
};
