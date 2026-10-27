import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { migrations } from "../../src/db/migrations";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { normalizeReviewLinkIds } from "../../src/domain/reviews/Review";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteReviewRepository } from "../../src/repositories/sqlite/SqliteReviewRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteIssueRepository } from "../../src/repositories/sqlite/SqliteIssueRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { ReviewService } from "../../src/services/reviews/ReviewService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
const draft = { title: "Review", reflection: "Keep", insight: "", nextFocus: "", domainId: null, reviewedOn: "2026-10-13" };
it("normalizes detached link ids and rejects malformed input", () => {
  const ids = [" z ", "a", "z"];
  expect(normalizeReviewLinkIds(ids)).toEqual(["a", "z"]);
  expect(ids).toEqual([" z ", "a", "z"]);
  for (const value of [[" "], [1], null, "goal"]) expect(() => normalizeReviewLinkIds(value as string[])).toThrow();
});
for (const memory of [false, true]) {
  it("persists, preserves, clears and snapshots associations; memory=" + memory, async () => {
    const db = memory ? null : new DatabaseSync(":memory:");
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    db?.exec("PRAGMA foreign_keys=ON");
    try {
      await new MigrationRunner(sql, migrations, clock).run();
      const goals = new SqliteGoalRepository(sql);
      const issues = new SqliteIssueRepository(sql);
      const timestamp = clock.now().toISOString();
      await goals.create({ id: "goal", title: "Goal", description: "", domainId: null, domainIds: [], status: "active", targetDate: null, sortOrder: 0, parentId: null, completedAt: null, createdAt: timestamp, updatedAt: timestamp });
      await issues.create({ id: "issue", title: "Issue", description: "", firstSeen: draft.reviewedOn, occurrenceCount: 1, causeHypothesis: "", attempts: "", followUp: "", status: "open", goalId: null, domainIds: [], createdAt: timestamp, updatedAt: timestamp });
      const repo = new SqliteReviewRepository(sql, true, true);
      const service = new ReviewService(repo, new SqliteLifeDomainRepository(sql), clock, { next: () => "review" }, goals, issues);
      const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
      await expect(service.create({ ...draft, goalIds: ["missing"] })).rejects.toThrow();
      await expect(service.create({ ...draft, issueIds: ["missing"] })).rejects.toThrow();
      expect(await repo.list()).toEqual([]);
      const created = await service.create({ ...draft, goalIds: ["goal", " goal "], issueIds: ["issue"] });
      expect(await repo.findById(created.id)).toMatchObject({ goalIds: ["goal"], issueIds: ["issue"] });
      await service.update(created.id, { ...draft, title: "Renamed" });
      expect(await repo.findById(created.id)).toMatchObject({ goalIds: ["goal"], issueIds: ["issue"] });
      expect((await history.list("review", created.id))[0].snapshot).toMatchObject({ goal_ids: ["goal"], issue_ids: ["issue"] });
      const before = await repo.findById(created.id);
      const versions = await history.list("review", created.id);
      const fault: SqliteExecutor = { select: sql.select.bind(sql), execute: sql.execute.bind(sql),
        executeTransaction: statements => sql.executeTransaction(statements.flatMap(statement =>
          statement.statement.startsWith("INSERT INTO review_issue_links") ? [statement, statement] : [statement])),
      };
      await expect(new SqliteReviewRepository(fault, true, true).update({ ...before!, title: "Failed" })).rejects.toThrow();
      expect(await repo.findById(created.id)).toEqual(before);
      expect(await history.list("review", created.id)).toEqual(versions);
      await service.update(created.id, { ...draft, goalIds: [], issueIds: [] });
      expect(await repo.list()).toMatchObject([{ goalIds: [], issueIds: [] }]);
      expect((await history.list("review", created.id))[0].snapshot).toMatchObject({ goal_ids: ["goal"], issue_ids: ["issue"] });
      if (db) {
        await service.update(created.id, { ...draft, goalIds: ["goal"], issueIds: ["issue"] });
        expect(() => db.prepare("DELETE FROM goals WHERE id='goal'").run()).toThrow();
        expect(() => db.prepare("DELETE FROM issues WHERE id='issue'").run()).toThrow();
        db.prepare("DELETE FROM reviews WHERE id='review'").run();
        expect(db.prepare("SELECT * FROM review_goal_links").all()).toEqual([]);
        expect(db.prepare("SELECT * FROM review_issue_links").all()).toEqual([]);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      }
    } finally { db?.close(); }
  });
}


it("upgrades schema 43 without rewriting review rows or history", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  try {
    const sql = nativeSqliteExecutor(db);
    await new MigrationRunner(sql, migrations.filter(m => m.id < "0044-v1-review-object-links"), clock).run();
    const repo = new SqliteReviewRepository(sql, true);
    const service = new ReviewService(repo, new SqliteLifeDomainRepository(sql), clock, { next: () => "old" });
    await service.create(draft);
    await service.update("old", { ...draft, title: "Old renamed" });
    const rows = db.prepare("SELECT * FROM reviews").all();
    const history = db.prepare("SELECT * FROM object_versions").all();
    expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds)
      .toEqual(migrations.filter(migration => migration.id >= "0044-v1-review-object-links").map(migration => migration.id));
    expect(db.prepare("SELECT * FROM reviews").all()).toEqual(rows);
    expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(history);
    expect(await new SqliteReviewRepository(sql, true, true).findById("old")).toMatchObject({ goalIds: [], issueIds: [] });
    expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds).toEqual([]);
  } finally { db.close(); }
});
