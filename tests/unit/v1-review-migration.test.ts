import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { migrations } from "../../src/db/migrations";
import { v1ReviewStructureMigration, reviewStructureColumns } from "../../src/db/migrations/0043-v1-review-structure";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { createReviewStructure, reviewTypes } from "../../src/domain/reviews/ReviewStructure";
import { decodeReviewStructure, encodeReviewStructure, type ReviewAnswerRow, type ReviewStructureColumns } from "../../src/repositories/reviews/ReviewStructureStorage";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
const legacyMigrations = migrations.filter(migration => migration.id < v1ReviewStructureMigration.id);
const candidateMigrations = migrations.filter(migration => migration.id <= v1ReviewStructureMigration.id);

it("creates the production schema in an empty database and keeps migration idempotent", async () => {
  const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
  try {
    db.exec("PRAGMA foreign_keys=ON");
    expect((await new MigrationRunner(sql, candidateMigrations, clock).run()).currentVersion).toBe(v1ReviewStructureMigration.id);
    expect((await new MigrationRunner(sql, candidateMigrations, clock).run()).appliedMigrationIds).toEqual([]);
    expect(db.prepare("SELECT * FROM review_answers").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { db.close(); }
});

it("allows explicit classification removal while retaining the prior template and answers in history", async () => {
  const { db, sql } = await fixture();
  try {
    await new MigrationRunner(sql, candidateMigrations, clock).run();
    const structured = encodeReviewStructure("old", createReviewStructure("annual", "2026-10-13"));
    await sql.executeTransaction([metadataUpdate(structured.columns), ...structured.answers.map(row => ({
      statement: "INSERT INTO review_answers VALUES (?,?,?)", bindValues: [row.review_id, row.field_key, row.value],
    }))]);
    await sql.executeTransaction([metadataUpdate(encodeReviewStructure("old", null).columns), {
      statement: "DELETE FROM review_answers WHERE review_id=?", bindValues: ["old"],
    }]);
    const row = db.prepare("SELECT * FROM reviews").get() as unknown as ReviewStructureColumns;
    expect(decodeReviewStructure("old", row, [])).toBeNull();
    expect(db.prepare("SELECT * FROM review_answers").all()).toEqual([]);
    const snapshot = JSON.parse(String(db.prepare("SELECT snapshot_json FROM object_versions ORDER BY id DESC LIMIT 1").get()?.snapshot_json));
    expect(snapshot.review_type).toBe("annual");
    expect(snapshot.answers).toHaveLength(structured.answers.length);
    expect(snapshot.template_snapshot).toBe(structured.columns.template_snapshot);
  } finally { db.close(); }
});

it("rolls back a failed candidate migration without leaving columns, tables or a version marker", async () => {
  const { db, sql } = await fixture();
  try {
    const original = db.prepare("SELECT * FROM reviews").all();
    const schema = db.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all();
    const failed = { ...v1ReviewStructureMigration, statements: [...v1ReviewStructureMigration.statements, "INSERT INTO missing_table VALUES (1)"] };
    await expect(new MigrationRunner(sql, [...legacyMigrations, failed], clock).run()).rejects.toThrow();
    expect(db.prepare("SELECT * FROM reviews").all()).toEqual(original);
    expect(db.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all()).toEqual(schema);
    expect(db.prepare("SELECT * FROM schema_migrations WHERE version='0043-v1-review-structure'").all()).toEqual([]);
    await new MigrationRunner(sql, candidateMigrations, clock).run();
    expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
  } finally { db.close(); }
});

function metadataUpdate(columns: ReviewStructureColumns) {
  return { statement: `UPDATE reviews SET ${reviewStructureColumns.map(key => `${key} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    bindValues: [...reviewStructureColumns.map(key => columns[key]), clock.now().toISOString(), "old"], requireAffectedRows: true };
}

it("rejects partial metadata and invalid modes without changing records or histories", async () => {
  const { db, sql } = await fixture();
  try {
    await new MigrationRunner(sql, candidateMigrations, clock).run();
    const valid = encodeReviewStructure("old", createReviewStructure("weekly", "2026-10-13")).columns;
    const original = db.prepare("SELECT * FROM reviews").get();
    const invalid = [
      ...reviewStructureColumns.map(key => ({ ...valid, [key]: null })),
      { ...valid, review_type: "unknown" }, { ...valid, review_status: "unknown" },
      { ...valid, review_mode: "narrative" }, { ...valid, template_snapshot: "[]" },
      { ...valid, template_snapshot: "null" }, { ...valid, template_snapshot: "{" },
      { ...valid, period_start: "2026-10-19" },
    ];
    for (const columns of invalid) {
      await expect(sql.executeTransaction([metadataUpdate(columns)])).rejects.toThrow();
      expect(db.prepare("SELECT * FROM reviews").get()).toEqual(original);
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual([]);
    }
    expect(() => db.exec("INSERT INTO reviews (id,title,reflection,insight,next_focus,reviewed_on,created_at,updated_at,review_type) VALUES ('bad','Bad','','','','2026-10-13','2026-10-13','2026-10-13','weekly')")).toThrow();
    expect(() => db.exec("INSERT INTO review_answers VALUES ('missing','key','value')")).toThrow();
    expect(() => db.exec("INSERT INTO review_answers VALUES ('old','','value')")).toThrow();
    expect(() => db.prepare("INSERT INTO review_answers VALUES ('old','key',?)").run("x".repeat(12001))).toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { db.close(); }
});

it.each(reviewTypes)("stores %s with blank answers and captures the old snapshot before replacement", async type => {
  const { db, sql } = await fixture();
  try {
    await new MigrationRunner(sql, candidateMigrations, clock).run();
    const structure = createReviewStructure(type, "2026-10-13");
    const key = structure.template.fields[0].key;
    structure.answers = { ...structure.answers, [key]: "Recorded fact" };
    const stored = encodeReviewStructure("old", structure);
    await sql.executeTransaction([metadataUpdate(stored.columns), ...stored.answers.map(row => ({
      statement: "INSERT INTO review_answers (review_id,field_key,value) VALUES (?,?,?)",
      bindValues: [row.review_id, row.field_key, row.value],
    }))]);
    const row = db.prepare("SELECT * FROM reviews WHERE id='old'").get() as unknown as ReviewStructureColumns;
    const answers = db.prepare("SELECT * FROM review_answers WHERE review_id='old' ORDER BY field_key").all() as unknown as ReviewAnswerRow[];
    expect(decodeReviewStructure("old", row, answers)).toEqual(structure);
    const initialHistory = JSON.parse(String(db.prepare("SELECT snapshot_json FROM object_versions ORDER BY id LIMIT 1").get()?.snapshot_json));
    expect(initialHistory.review_type).toBeNull();
    expect(initialHistory.answers).toEqual([]);
    await sql.executeTransaction([metadataUpdate(stored.columns), { statement: "UPDATE review_answers SET value='' WHERE review_id='old'" }]);
    const previous = JSON.parse(String(db.prepare("SELECT snapshot_json FROM object_versions ORDER BY id DESC LIMIT 1").get()?.snapshot_json));
    expect(previous.review_type).toBe(type);
    expect(previous.template_snapshot).toBe(stored.columns.template_snapshot);
    expect(previous.answers.find((answer: { field_key: string }) => answer.field_key === key).value).toBe("Recorded fact");
    expect(db.prepare("SELECT count(*) AS n FROM review_answers WHERE value=''").get()?.n).toBe(structure.template.fields.length);
    await expect(sql.executeTransaction([metadataUpdate(stored.columns), {
      statement: "INSERT INTO review_answers (review_id,field_key,value) VALUES (?,?,?)",
      bindValues: ["old", key, "Duplicate"],
    }])).rejects.toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM object_versions").get()?.n).toBe(2);
    db.exec("DELETE FROM reviews WHERE id='old'");
    expect(db.prepare("SELECT * FROM review_answers").all()).toEqual([]);
  } finally { db.close(); }
});

async function fixture() {
  const db = new DatabaseSync(":memory:");
  const sql = nativeSqliteExecutor(db);
  try {
    db.exec("PRAGMA foreign_keys=ON");
    await new MigrationRunner(sql, legacyMigrations, clock).run();
    db.exec(`INSERT INTO reviews (id,title,reflection,insight,next_focus,reviewed_on,created_at,updated_at)
      VALUES ('old','Original','Facts','Insight','Next','2026-10-13','2026-10-13','2026-10-13')`);
    return { db, sql };
  } catch (error) { db.close(); throw error; }
}

it("preserves legacy records, histories, other triggers and sequence; migration is repeatable", async () => {
  const { db, sql } = await fixture();
  try {
    db.exec("UPDATE reviews SET title='Renamed' WHERE id='old'; INSERT INTO object_versions VALUES (90,'goal','removed','2026-10-13','{}'); DELETE FROM object_versions WHERE id=90");
    const original = db.prepare("SELECT * FROM reviews").get()!;
    const history = db.prepare("SELECT * FROM object_versions").all();
    const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name!='reviews_versions_before_update' ORDER BY name").all();
    await new MigrationRunner(sql, candidateMigrations, clock).run();
    const row = db.prepare("SELECT * FROM reviews").get()!;
    expect(row).toMatchObject(original);
    expect(reviewStructureColumns.map(key => row[key])).toEqual(Array(6).fill(null));
    expect(db.prepare("SELECT * FROM review_answers").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(history);
    expect(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name NOT IN ('reviews_versions_before_update','reviews_structure_guard_0','reviews_structure_guard_1') ORDER BY name").all()).toEqual(triggers);
    expect((await new MigrationRunner(sql, candidateMigrations, clock).run()).appliedMigrationIds).toEqual([]);
    db.exec("UPDATE reviews SET title='After' WHERE id='old'");
    expect(db.prepare("SELECT max(id) AS id FROM object_versions").get()?.id).toBe(91);
    expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
  } finally { db.close(); }
});
