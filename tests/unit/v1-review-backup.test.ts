import { describe, expect, it } from "vitest";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { inspectReviewBackup } from "../../src/domain/backup/ReviewBackup";
import { createReviewStructure, reviewTypes } from "../../src/domain/reviews/ReviewStructure";
import { encodeReviewStructure } from "../../src/repositories/reviews/ReviewStructureStorage";

function fixture() {
  const stored = encodeReviewStructure("review-1", createReviewStructure("weekly", "2026-10-13"));
  return {
    format: "lifeos-backup", schemaVersion: 43, appVersion: "0.1.0", exportedAt: "2026-10-13T08:00:00Z",
    data: {
      ...Object.fromEntries(backupTables.map(table => [table, []])),
      reviews: [{ id: "review-1", title: "复盘", reflection: "旧正文", insight: "", next_focus: "", domain_id: null,
        reviewed_on: "2026-10-13", created_at: "2026-10-13T08:00:00Z", updated_at: "2026-10-13T08:00:00Z",
        ...stored.columns }],
      review_answers: [...stored.answers],
      object_versions: [] as Record<string, unknown>[],
    },
  };
}

function history(backup: ReturnType<typeof fixture>) {
  const row = backup.data.reviews[0];
  const snapshot: Record<string, unknown> = { ...row,
    answers: backup.data.review_answers.map(({ field_key, value }) => ({ field_key, value })) };
  backup.data.object_versions.push({ id: 1, object_type: "review", object_id: row.id,
    changed_at: "2026-10-13T09:00:00Z", snapshot_json: JSON.stringify(snapshot) });
  return snapshot;
}

function changeHistory(backup: ReturnType<typeof fixture>, change: (snapshot: Record<string, unknown>) => void) {
  const snapshot = history(backup);
  change(snapshot);
  backup.data.object_versions[0].snapshot_json = JSON.stringify(snapshot);
}

describe("candidate V1 review backup preflight", () => {
  it.each(reviewTypes)("validates %s, blank answers and detached history without changing data", type => {
    const backup = fixture();
    const stored = encodeReviewStructure("review-1", createReviewStructure(type, "2026-10-13"));
    Object.assign(backup.data.reviews[0], stored.columns);
    backup.data.review_answers = [...stored.answers];
    history(backup);
    const before = JSON.stringify(backup);
    const report = inspectReviewBackup(backup);
    expect(report.counts.review_answers).toBe(stored.answers.length);
    expect(report.total).toBe(stored.answers.length + 2);
    expect(report.backup).toBe(backup);
    expect(JSON.stringify(backup)).toBe(before);
  });

  it("validates 43 through the production preflight while retaining schema 42 compatibility", () => {
    const candidate = fixture();
    expect(inspectBackup(candidate)).toEqual(inspectReviewBackup(candidate));
    const data = Object.fromEntries(backupTables.map(table => [table, []]));
    expect(inspectBackup({ ...candidate, schemaVersion: 42, data }).total).toBe(0);
    expect(() => inspectReviewBackup({ ...candidate, schemaVersion: 42 })).toThrow("43");
  });

  it("accepts migrated unclassified rows and old histories without inventing classification", () => {
    const backup = fixture();
    Object.assign(backup.data.reviews[0], encodeReviewStructure("review-1", null).columns);
    backup.data.review_answers = [];
    history(backup);
    backup.data.object_versions.push({ object_type: "review", object_id: "deleted-old-review",
      snapshot_json: JSON.stringify({ reflection: "旧内容" }) });
    expect(inspectReviewBackup(backup).total).toBe(3);
    expect(backup.data.reviews[0].review_type).toBeNull();
  });

  it("rejects missing or extra tables, malformed cells and orphan answers", () => {
    for (const change of [
      (b: ReturnType<typeof fixture>) => { Reflect.deleteProperty(b.data, "review_answers"); },
      (b: ReturnType<typeof fixture>) => { Object.assign(b.data, { unknown: [] }); },
      (b: ReturnType<typeof fixture>) => { b.data.review_answers[0].review_id = "missing"; },
      (b: ReturnType<typeof fixture>) => { Object.assign(b.data.review_answers[0], { value: 0 }); },
      (b: ReturnType<typeof fixture>) => { Object.assign(b.data.review_answers[0], { extra: null }); },
      (b: ReturnType<typeof fixture>) => { b.data.review_answers[0].review_id = " review-1"; },
    ]) {
      const backup = fixture(); change(backup);
      expect(() => inspectReviewBackup(backup)).toThrow();
    }
  });

  it("rejects partial metadata, bad periods, corrupt templates and incomplete answers", () => {
    for (const change of [
      (b: ReturnType<typeof fixture>) => { Reflect.deleteProperty(b.data.reviews[0], "review_type"); },
      (b: ReturnType<typeof fixture>) => { b.data.reviews[0].review_status = null; },
      (b: ReturnType<typeof fixture>) => { b.data.reviews[0].period_start = "2026-10-13"; },
      (b: ReturnType<typeof fixture>) => { b.data.reviews[0].template_snapshot = "{broken"; },
      (b: ReturnType<typeof fixture>) => { b.data.review_answers.pop(); },
      (b: ReturnType<typeof fixture>) => { b.data.review_answers.push(b.data.review_answers[0]); },
      (b: ReturnType<typeof fixture>) => { b.data.review_answers[0].field_key = "unknown"; },
      (b: ReturnType<typeof fixture>) => { b.data.review_answers[0].value = "x".repeat(12001); },
      (b: ReturnType<typeof fixture>) => { Object.assign(b.data.reviews[0], encodeReviewStructure("review-1", null).columns); },
    ]) {
      const backup = fixture(); change(backup);
      const before = JSON.stringify(backup);
      expect(() => inspectReviewBackup(backup)).toThrow();
      expect(JSON.stringify(backup)).toBe(before);
    }
  });

  it("rejects damaged historical metadata and answers even when current rows are valid", () => {
    for (const change of [
      (s: Record<string, unknown>) => { delete s.answers; },
      (s: Record<string, unknown>) => { delete s.review_type; },
      (s: Record<string, unknown>) => { s.period_end = "2026-10-17"; },
      (s: Record<string, unknown>) => { s.template_snapshot = "null"; },
      (s: Record<string, unknown>) => { s.answers = []; },
      (s: Record<string, unknown>) => { s.answers = [{ field_key: "execution", value: null }]; },
      (s: Record<string, unknown>) => { s.answers = [{ field_key: "execution", value: "", extra: "bad" }]; },
    ]) {
      const backup = fixture(); changeHistory(backup, change);
      expect(() => inspectReviewBackup(backup)).toThrow();
    }
  });

  it("still applies existing non-review validation", () => {
    const backup = fixture();
    Object.assign(backup.data, { actions: [{ id: "action-1", details_json: "{broken" }] });
    expect(() => inspectReviewBackup(backup)).toThrow();
  });
});

