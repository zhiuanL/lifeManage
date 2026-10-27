import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { migrations } from "../../src/db/migrations";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { createReviewStructure, reviewTypes } from "../../src/domain/reviews/ReviewStructure";
import { applyReviewFactDraft, buildReviewFactDraft, type ReviewFactData } from "../../src/domain/reviews/ReviewFactDraft";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteReviewRepository } from "../../src/repositories/sqlite/SqliteReviewRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { ReviewService } from "../../src/services/reviews/ReviewService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
const draft = { title: "Review", reflection: "Notes", insight: "", nextFocus: "", domainId: null, reviewedOn: "2026-10-13" };
for (const memory of [false, true]) {
  async function setup() {
    const db = memory ? null : new DatabaseSync(":memory:");
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    db?.exec("PRAGMA foreign_keys=ON");
    await new MigrationRunner(sql, migrations, clock).run();
    const repo = new SqliteReviewRepository(sql, true);
    const service = new ReviewService(repo, new SqliteLifeDomainRepository(sql), clock, { next: () => "review" });
    return { db, sql, repo, service, history: new VersionHistoryService(new SqliteObjectVersionRepository(sql)) };
  }
  it("keeps legacy writes usable and rejects disabled structured writes; memory=" + memory, async () => {
    const db = memory ? null : new DatabaseSync(":memory:");
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      await new MigrationRunner(sql, migrations.filter(m => m.id < "0043-v1-review-structure"), clock).run();
      const repo = new SqliteReviewRepository(sql);
      const service = new ReviewService(repo, new SqliteLifeDomainRepository(sql), clock, { next: () => "legacy" });
      const created = await service.create(draft);
      expect(created.structure).toBeUndefined();
      await expect(service.update(created.id, { ...draft, structure: createReviewStructure("daily", draft.reviewedOn) })).rejects.toThrow();
      expect(await repo.findById(created.id)).toEqual(created);
      expect(await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("review", created.id)).toEqual([]);
      await new MigrationRunner(sql, migrations, clock).run();
      const candidate = new SqliteReviewRepository(sql, true);
      const old = await candidate.findById(created.id);
      expect(old).toEqual({ ...created, structure: null });
    } finally { db?.close(); }
  });
  it("rolls back main row, answers and history on a mid-answer failure; memory=" + memory, async () => {
    const { db, sql, repo, service, history } = await setup();
    try {
      const structure = createReviewStructure("monthly", draft.reviewedOn);
      const created = await service.create({ ...draft, structure });
      const fault: SqliteExecutor = {
        select: sql.select.bind(sql), execute: sql.execute.bind(sql),
        executeTransaction: statements => sql.executeTransaction(statements.flatMap(statement =>
          statement.statement.startsWith("INSERT INTO review_answers") ? [statement, statement] : [statement])),
      };
      const faultyRepo = new SqliteReviewRepository(fault, true);
      await expect(faultyRepo.update({ ...created, title: "Failed update" })).rejects.toThrow();
      expect(await repo.findById(created.id)).toEqual(created);
      expect(await history.list("review", created.id)).toEqual([]);
      await expect(faultyRepo.create({ ...created, id: "failed-create" })).rejects.toThrow();
      expect(await repo.findById("failed-create")).toBeNull();
      expect(await repo.list()).toEqual([created]);
    } finally { db?.close(); }
  });
  it("retains omitted structure, snapshots old answers, clears explicitly and rolls back links; memory=" + memory, async () => {
    const { db, sql, repo, service, history } = await setup();
    try {
      const structure = createReviewStructure("weekly", draft.reviewedOn);
      const field = structure.template.fields[0].key;
      const initial = { ...structure, answers: { ...structure.answers, [field]: "Original" } };
      const review = await service.create({ ...draft, structure: initial });
      await service.update(review.id, { ...draft, title: "Rename" });
      expect((await repo.findById(review.id))?.structure).toEqual(initial);
      const updated = { ...initial, status: "completed" as const, answers: { ...initial.answers, [field]: "Changed" } };
      await service.update(review.id, { ...draft, structure: updated });
      const versions = await history.list("review", review.id);
      expect(versions).toHaveLength(2);
      expect(versions[0].snapshot).toMatchObject({ review_type: "weekly", review_status: "draft", template_snapshot: JSON.stringify(initial.template) });
      expect(versions[0].snapshot.answers).toEqual(initial.template.fields
        .map(({ key }) => ({ field_key: key, value: initial.answers[key] })).sort((a, b) => a.field_key.localeCompare(b.field_key)));
      const before = await repo.findById(review.id);
      await expect(repo.update({ ...before!, structure: initial, domainId: "missing", domainIds: ["missing"] })).rejects.toThrow();
      expect(await repo.findById(review.id)).toEqual(before);
      expect(await history.list("review", review.id)).toEqual(versions);
      await expect(service.update(review.id, { ...draft, structure: { ...initial, end: "2026-10-14" } })).rejects.toThrow();
      await expect(repo.update({ ...before!, id: "missing" })).rejects.toThrow();
      expect(await history.list("review", review.id)).toEqual(versions);
      const cleared = await service.update(review.id, { ...draft, structure: null });
      expect(cleared.structure).toBeNull();
      expect((await repo.findById(review.id))?.structure).toBeNull();
      expect(await sql.select("SELECT review_id, field_key, value FROM review_answers WHERE review_id = ? ORDER BY field_key", [review.id])).toEqual([]);
      expect((await history.list("review", review.id))[0].snapshot.review_status).toBe("completed");
    } finally { db?.close(); }
  });
  it("persists fact drafts, edits and explicit blanks with original history; memory=" + memory, async () => {
    const { db, sql, repo, service, history } = await setup();
    try {
      const writer = new ReviewService(repo, new SqliteLifeDomainRepository(sql), clock, { next: () => "source" });
      const daily = createReviewStructure("daily", draft.reviewedOn);
      const source = await writer.create({ ...draft, structure: {
        ...daily, answers: { ...daily.answers, completed: "Recorded daily fact" },
      } });
      const data: ReviewFactData = {
        reviews: [source], actions: [], goals: [], items: [], issues: [],
        metrics: [], records: [], changes: [], habits: [], logs: [], observedOn: draft.reviewedOn,
      };
      const weekly = createReviewStructure("weekly", draft.reviewedOn);
      const initial = applyReviewFactDraft(weekly, buildReviewFactDraft(weekly, data));
      expect(initial.answers.execution).toContain("Recorded daily fact");
      const created = await service.create({ ...draft, structure: initial });
      expect((await repo.findById(created.id))?.structure).toEqual(initial);
      const edited = { ...initial, answers: { ...initial.answers, execution: "My correction" } };
      await service.update(created.id, { ...draft, structure: edited });
      expect((await repo.findById(created.id))?.structure?.answers.execution).toBe("My correction");
      const cleared = { ...edited, answers: { ...edited.answers, execution: "" } };
      await service.update(created.id, { ...draft, structure: cleared });
      expect((await repo.findById(created.id))?.structure?.answers.execution).toBe("");
      const versions = await history.list("review", created.id);
      expect(versions).toHaveLength(2);
      expect(versions.map(version => version.snapshot.answers)).toEqual([
        expect.arrayContaining([{ field_key: "execution", value: "My correction" }]),
        expect.arrayContaining([{ field_key: "execution", value: initial.answers.execution }]),
      ]);
      expect((await repo.findById(source.id))?.structure?.answers.completed).toBe("Recorded daily fact");
    } finally { db?.close(); }
  });
  for (const type of reviewTypes) it("persists detached templates and explicit blanks: " + type + "; memory=" + memory, async () => {
    const { db, repo, service } = await setup();
    try {
      const structure = createReviewStructure(type, draft.reviewedOn);
      const created = await service.create({ ...draft, structure });
      expect(created.structure).toEqual(structure);
      expect(created.structure).not.toBe(structure);
      expect(created.structure?.template).not.toBe(structure.template);
      const loaded = await repo.findById(created.id);
      expect(loaded).toEqual(created);
      expect(await repo.list()).toEqual([created]);
      expect(Object.values(loaded!.structure!.answers).every(value => value === "")).toBe(true);
      await expect(service.create({ ...draft, structure })).rejects.toThrow();
      expect(await repo.findById(created.id)).toEqual(loaded);
      expect(await repo.findById("missing")).toBeNull();
    } finally { db?.close(); }
  });
}

