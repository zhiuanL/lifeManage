import type { Migration } from "./types";

export const reviewStructureColumns = [
  "review_type", "period_start", "period_end", "review_status", "review_mode", "template_snapshot",
] as const;

const validMetadata = `
  (${reviewStructureColumns.map(column => `NEW.${column} IS NULL`).join(" AND ")})
  OR (${reviewStructureColumns.map(column => `NEW.${column} IS NOT NULL`).join(" AND ")}
    AND NEW.review_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'annual')
    AND NEW.review_status IN ('draft', 'completed')
    AND NEW.review_mode IN ('structured', 'narrative')
    AND (NEW.review_mode != 'narrative' OR NEW.review_type IN ('monthly', 'quarterly', 'annual'))
    AND length(NEW.period_start) = 10 AND length(NEW.period_end) = 10
    AND NEW.period_start <= NEW.period_end
    AND json_valid(NEW.template_snapshot)
    AND json_type(NEW.template_snapshot) = 'object')`;

export const v1ReviewStructureMigration: Migration = {
  id: "0043-v1-review-structure",
  statements: [
    ...reviewStructureColumns.map(column => `ALTER TABLE reviews ADD COLUMN ${column} TEXT`),
    `CREATE TABLE review_answers (
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL CHECK (length(field_key) BETWEEN 1 AND 64),
      value TEXT NOT NULL CHECK (length(value) <= 12000),
      PRIMARY KEY (review_id, field_key)
    )`,
    "CREATE INDEX idx_reviews_period ON reviews (review_type, period_start, period_end)",
    ...["INSERT", `UPDATE OF ${reviewStructureColumns.join(", ")}`].map((event, index) =>
      `CREATE TRIGGER reviews_structure_guard_${index}
        BEFORE ${event} ON reviews
        WHEN NOT (${validMetadata})
        BEGIN SELECT RAISE(ABORT, 'Invalid review structure metadata'); END`),
    "DROP TRIGGER reviews_versions_before_update",
    `CREATE TRIGGER reviews_versions_before_update
      BEFORE UPDATE OF title, reflection, insight, next_focus, domain_id,
        reviewed_on, review_type, period_start, period_end, review_status,
        review_mode, template_snapshot ON reviews
      BEGIN
        INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
        VALUES ('review', OLD.id, NEW.updated_at, json_object(
          'title', OLD.title, 'reflection', OLD.reflection, 'insight', OLD.insight,
          'next_focus', OLD.next_focus, 'domain_id', OLD.domain_id,
          'reviewed_on', OLD.reviewed_on, 'created_at', OLD.created_at,
          'updated_at', OLD.updated_at, 'privacy_level', OLD.privacy_level,
          'review_type', OLD.review_type, 'period_start', OLD.period_start,
          'period_end', OLD.period_end, 'review_status', OLD.review_status,
          'review_mode', OLD.review_mode, 'template_snapshot', OLD.template_snapshot,
          'answers', (SELECT json_group_array(json_object(
            'field_key', field_key, 'value', value
          )) FROM (
            SELECT field_key, value FROM review_answers
            WHERE review_id = OLD.id ORDER BY field_key
          )),
          'domain_ids', (SELECT json_group_array(domain_id)
            FROM review_domain_links WHERE review_id = OLD.id)
        ));
      END`,
  ],
};
