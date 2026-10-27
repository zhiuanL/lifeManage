import type { Migration } from "./types";

export const v1ReviewDomainLinksMigration: Migration = {
  id: "0023-v1-review-domain-links",
  statements: [
    `CREATE TABLE review_domain_links (
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      domain_id TEXT NOT NULL REFERENCES life_domains(id) ON DELETE CASCADE,
      PRIMARY KEY (review_id, domain_id)
    )`,
    `CREATE INDEX idx_review_domain_links_domain ON review_domain_links (domain_id, review_id)`,
    `INSERT INTO review_domain_links (review_id, domain_id)
      SELECT id, domain_id FROM reviews WHERE domain_id IS NOT NULL`,
    `DROP TRIGGER reviews_versions_before_update`,
    `CREATE TRIGGER reviews_versions_before_update
      BEFORE UPDATE OF title, reflection, insight, next_focus, domain_id, reviewed_on ON reviews
      BEGIN
        INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
        VALUES ('review', OLD.id, NEW.updated_at, json_object(
          'title', OLD.title, 'reflection', OLD.reflection, 'insight', OLD.insight,
          'next_focus', OLD.next_focus, 'domain_id', OLD.domain_id,
          'reviewed_on', OLD.reviewed_on, 'created_at', OLD.created_at,
          'updated_at', OLD.updated_at, 'privacy_level', OLD.privacy_level,
          'domain_ids', (SELECT json_group_array(domain_id) FROM review_domain_links
            WHERE review_id = OLD.id)
        ));
      END`,
  ],
};
