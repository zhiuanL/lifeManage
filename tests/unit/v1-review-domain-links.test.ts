import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { v1ReviewDomainLinksMigration } from "../../src/db/migrations/0023-v1-review-domain-links";
import { normalizeReviewDraft } from "../../src/domain/reviews/Review";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteReviewRepository } from "../../src/repositories/sqlite/SqliteReviewRepository";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { ReviewService } from "../../src/services/reviews/ReviewService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-09-30T08:00:00Z") };
const domainDraft = (name: string) => ({
  name, description: "", focus: "", color: "fern" as const, icon: "heart" as const,
});
const reviewDraft = {
  title: "周回顾", reflection: "整理现状", insight: "", nextFocus: "",
  domainId: null, reviewedOn: "2026-09-30",
};

describe("V1 review domain context", () => {
  it("backfills old links without changing review rows or their version history", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0,
        migrations.indexOf(v1ReviewDomainLinksMigration)), clock).run();
      const domains = new SqliteLifeDomainRepository(sql);
      await new LifeDomainService(domains, clock, { next: () => "health" })
        .create(domainDraft("健康"));
      db.prepare(`INSERT INTO reviews (id, title, domain_id, reviewed_on, created_at, updated_at)
        VALUES ('old', '原有回顾', 'health', '2026-09-20', '2026-09-20', '2026-09-20')`).run();
      db.prepare(`INSERT INTO reviews (id, title, reviewed_on, created_at, updated_at)
        VALUES ('free', '独立回顾', '2026-09-19', '2026-09-19', '2026-09-19')`).run();
      const before = db.prepare("SELECT * FROM reviews ORDER BY id").all();
      const history = db.prepare("SELECT * FROM object_versions").all();

      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds)
        .toEqual(migrations.slice(migrations.indexOf(v1ReviewDomainLinksMigration)).map(migration => migration.id));
      expect(db.prepare("SELECT * FROM reviews ORDER BY id").all()).toEqual(
        before.map(row => ({ ...row, review_type: null, period_start: null, period_end: null,
          review_status: null, review_mode: null, template_snapshot: null })),
      );
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(history);
      const repository = new SqliteReviewRepository(sql);
      expect((await repository.findById("old"))?.domainIds).toEqual(["health"]);
      expect((await repository.findById("free"))?.domainIds).toEqual([]);
      expect(db.prepare("SELECT * FROM review_domain_links").all())
        .toEqual([{ review_id: "old", domain_id: "health" }]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds).toEqual([]);
    } finally { db.close(); }
  });

  for (const [name, create] of [
    ["SQLite", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("PRAGMA foreign_keys = ON");
      return { sql: nativeSqliteExecutor(db), db, close: () => db.close() };
    }],
    ["browser preview", () => ({
      sql: new MemorySqliteExecutor(), db: null, close: () => {},
    })],
  ] as const) {
    it(`${name} creates 0..N links and rolls back failed updates`, async () => {
      const { sql, db, close } = create();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let counter = 0;
        const ids = { next: () => `item-${++counter}` };
        const domains = new SqliteLifeDomainRepository(sql);
        const repository = new SqliteReviewRepository(sql);
        const service = new ReviewService(repository, domains, clock, ids);
        const life = new LifeDomainService(domains, clock, ids);
        const health = await life.create(domainDraft("健康"));
        const work = await life.create(domainDraft("事业"));
        const growth = await life.create(domainDraft("成长"));
        const review = await service.create({
          ...reviewDraft, domainIds: [health.id, work.id, health.id],
        });
        expect((await repository.findById(review.id))?.domainIds).toEqual([health.id, work.id]);
        await service.update(review.id, { ...review, title: "调整回顾",
          domainIds: [work.id, growth.id] });
        expect(await repository.findById(review.id)).toMatchObject({
          domainId: work.id, domainIds: [work.id, growth.id],
        });
        const history = await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("review", review.id);
        expect(history[0].snapshot).toMatchObject({
          title: review.title, domain_ids: [health.id, work.id],
        });
        const before = await repository.findById(review.id);
        await expect(service.update(review.id, { ...review, domainIds: [growth.id, "missing"] }))
          .rejects.toThrow("关联的生活领域");
        await expect(repository.update({ ...review, title: "写入失败",
          domainId: growth.id, domainIds: [growth.id, "missing"] })).rejects.toThrow();
        expect(await repository.findById(review.id)).toEqual(before);
        expect(await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("review", review.id)).toEqual(history);
        await expect(repository.update({ ...review, id: "missing",
          domainId: null, domainIds: [] })).rejects.toThrow();
        await service.update(review.id, { ...review, domainIds: [] });
        expect(await repository.findById(review.id)).toMatchObject({
          domainId: null, domainIds: [],
        });
        expect(normalizeReviewDraft({ ...reviewDraft, domainId: health.id }).domainIds)
          .toEqual([health.id]);
        if (db) expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { close(); }
    });
  }
});
