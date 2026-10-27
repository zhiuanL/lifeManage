import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { migrations } from "../../src/db/migrations";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { inspectReviewBackup, reviewBackupTables } from "../../src/domain/backup/ReviewBackup";
import { createReviewStructure, reviewTypes } from "../../src/domain/reviews/ReviewStructure";
import { SqliteReviewRepository } from "../../src/repositories/sqlite/SqliteReviewRepository";
import { ReviewService } from "../../src/services/reviews/ReviewService";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";


it.each(reviewTypes)("round-trips SQLite %s with templates, blank answers and history", async type => {
  const source = await setup(); const target = await setup();
  try {
    const structure = createReviewStructure(type, draft.reviewedOn);
    const created = await source.service.create({ ...draft, structure });
    await source.service.update(created.id, { ...draft, structure: { ...structure, status: "completed" } });
    const backup = snapshot(source.db); const before = JSON.stringify(backup);
    expect(inspectReviewBackup(backup).counts.review_answers).toBe(structure.template.fields.length);
    restore(target.db, backup);
    expect(snapshot(target.db).data).toEqual(backup.data);
    expect(await target.repo.list()).toEqual(await source.repo.list());
    expect(JSON.stringify(backup)).toBe(before);
    expect(target.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { source.db.close(); target.db.close(); }
});

it("backs up object links, rejects corrupt references and accepts schema 43", async () => {
  const source = await setup(); const target = await setup();
  try {
    source.db.prepare("INSERT INTO goals (id,title,status,sort_order,created_at,updated_at) VALUES ('goal','Goal','active',0,?,?)").run(clock.now().toISOString(), clock.now().toISOString());
    source.db.prepare("INSERT INTO issues (id,title,first_seen,status,created_at,updated_at) VALUES ('issue','Issue',?,'open',?,?)").run(draft.reviewedOn, clock.now().toISOString(), clock.now().toISOString());
    const repo = new SqliteReviewRepository(nativeSqliteExecutor(source.db), true, true);
    const created = await source.service.create(draft);
    await repo.update({ ...created, goalIds: ["goal"], issueIds: ["issue"] });
    await repo.update({ ...created, title: "Updated", goalIds: ["goal"], issueIds: ["issue"] });
    const backup = snapshot(source.db);
    expect(inspectBackup(backup).counts.review_goal_links).toBe(1);
    expect(inspectBackup(backup).counts.review_issue_links).toBe(1);
    restore(target.db, backup);
    const targetRepo = new SqliteReviewRepository(nativeSqliteExecutor(target.db), true, true);
    expect(await targetRepo.findById(created.id)).toMatchObject({ goalIds: ["goal"], issueIds: ["issue"] });
    const baseline = snapshot(target.db).data;
    for (const table of ["review_goal_links", "review_issue_links"]) {
      for (const invalid of ["target", "review", "duplicate", "extra"]) {
        const corrupt = structuredClone(backup);
        const row = corrupt.data[table][0];
        if (invalid === "target") row[table === "review_goal_links" ? "goal_id" : "issue_id"] = "missing";
        if (invalid === "review") row.review_id = "missing";
        if (invalid === "duplicate") corrupt.data[table].push({ ...row });
        if (invalid === "extra") row.extra = "invalid";
        expect(() => restore(target.db, corrupt)).toThrow();
        expect(snapshot(target.db).data).toEqual(baseline);
      }
    }
    const oldData = structuredClone(backup.data);
    delete oldData.review_goal_links; delete oldData.review_issue_links;
    expect(inspectBackup({ ...backup, schemaVersion: 43, data: oldData }).counts.reviews).toBe(1);
    restore(target.db, { ...backup, data: { ...oldData, review_goal_links: [], review_issue_links: [] } });
    expect(await targetRepo.findById(created.id)).toMatchObject({ goalIds: [], issueIds: [] });
    expect(snapshot(target.db).data.object_versions).toEqual(oldData.object_versions);
  } finally { source.db.close(); target.db.close(); }
});
it("rejects corruption before deletion and rolls back failures after answers", async () => {
  const source = await setup(); const target = await setup();
  try {
    await source.service.create({ ...draft, structure: createReviewStructure("weekly", draft.reviewedOn) });
    await target.service.create({ ...draft, title: "Existing data" });
    const baseline = snapshot(target.db).data; const backup = snapshot(source.db);
    for (const corrupt of [
      (data: Dataset) => { data.reviews[0].period_end = "2026-10-13"; },
      (data: Dataset) => { data.review_answers[0].review_id = "missing"; },
      (data: Dataset) => { data.review_answers.push({ ...data.review_answers[0] }); },
      (data: Dataset) => { data.review_answers.pop(); },
    ]) {
      const invalid = structuredClone(backup); corrupt(invalid.data);
      expect(() => restore(target.db, invalid)).toThrow();
      expect(snapshot(target.db).data).toEqual(baseline);
    }
    expect(() => restore(target.db, backup, true)).toThrow("Injected restore failure");
    expect(snapshot(target.db).data).toEqual(baseline);
    expect(target.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { source.db.close(); target.db.close(); }
});
const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
type Dataset = Record<string, Record<string, unknown>[]>;
async function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const sql = nativeSqliteExecutor(db);
  await new MigrationRunner(sql, migrations, clock).run();
  const repo = new SqliteReviewRepository(sql, true);
  let id = 0;
  const service = new ReviewService(repo, new SqliteLifeDomainRepository(sql), clock, { next: () => "review-" + ++id });
  return { db, repo, service };
}
function snapshot(db: DatabaseSync) {
  return {
    format: "lifeos-backup", schemaVersion: 44, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
    data: Object.fromEntries(reviewBackupTables.map(table => [table, db.prepare("SELECT * FROM " + table).all()])) as Dataset,
  };
}
// Isolated contract harness, not production Tauri restore.
function restore(db: DatabaseSync, backup: ReturnType<typeof snapshot>, fail = false) {
  inspectReviewBackup(backup);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of [...reviewBackupTables].reverse()) db.exec("DELETE FROM " + table);
    for (const table of reviewBackupTables) {
      for (const row of backup.data[table]) {
        const columns = Object.keys(row);
        db.prepare("INSERT INTO " + table + " (" + columns.join(",") + ") VALUES (" + columns.map(() => "?").join(",") + ")")
          .run(...Object.values(row) as (string | number | null)[]);
      }
      if (fail && table === "review_answers") throw new Error("Injected restore failure");
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
const draft = { title: "Review", reflection: "Original notes", insight: "", nextFocus: "", domainId: null, reviewedOn: "2026-10-13" };


it("retains old schema 42 content and history without inventing review classification", async () => {
  const source = await setup(); const target = await setup();
  try {
    const created = await source.service.create(draft);
    await source.service.update(created.id, { ...draft, title: "Old review" });
    const backup = snapshot(source.db);
    const columns = ["review_type", "period_start", "period_end", "review_status", "review_mode", "template_snapshot"];
    const oldData: Dataset = Object.fromEntries(backupTables.map(table => [table, structuredClone(backup.data[table])]));
    for (const row of oldData.reviews) for (const column of columns) delete row[column];
    for (const row of oldData.object_versions) {
      const history = JSON.parse(String(row.snapshot_json));
      for (const column of columns) delete history[column];
      delete history.answers;
      row.snapshot_json = JSON.stringify(history);
    }
    expect(inspectBackup({ ...backup, schemaVersion: 42, data: oldData }).counts.reviews).toBe(1);
    const upgraded = { ...backup, data: { ...structuredClone(oldData), review_answers: [], review_goal_links: [], review_issue_links: [] } as Dataset };
    for (const row of upgraded.data.reviews) for (const column of columns) row[column] = null;
    restore(target.db, upgraded);
    const loaded = await target.repo.findById(created.id);
    expect(loaded?.structure).toBeNull();
    expect(loaded?.reflection).toBe(draft.reflection);
    expect(snapshot(target.db).data.object_versions).toEqual(oldData.object_versions);
  } finally { source.db.close(); target.db.close(); }
});
