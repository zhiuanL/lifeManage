import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { v1GoalDomainLinksMigration } from "../../src/db/migrations/0021-v1-goal-domain-links";
import { normalizeGoalDraft } from "../../src/domain/planning/Goal";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { GoalService } from "../../src/services/planning/GoalService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-09-29T08:00:00Z") };
const domainDraft = (name: string) => ({
  name, description: "", focus: "", color: "fern" as const, icon: "heart" as const,
});
const goalDraft = {
  title: "持续学习", description: "", domainId: null,
  status: "active" as const, targetDate: null,
};

describe("V1 goal domain context", () => {
  it("migrates legacy goals without changing their original ownership or history", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, migrations.indexOf(v1GoalDomainLinksMigration)), clock).run();
      const domains = new SqliteLifeDomainRepository(sql);
      const life = new LifeDomainService(domains, clock, { next: () => "health" });
      await life.create(domainDraft("健康"));
      db.prepare(`INSERT INTO goals (id, title, domain_id, status, sort_order, created_at, updated_at)
        VALUES ('old', '保留旧目标', 'health', 'active', 0, '2026-09-20', '2026-09-20')`).run();
      db.prepare(`INSERT INTO goals (id, title, status, sort_order, created_at, updated_at)
        VALUES ('unlinked', '自由目标', 'active', 1, '2026-09-20', '2026-09-20')`).run();
      const before = db.prepare("SELECT * FROM goals ORDER BY id").all();
      const history = db.prepare("SELECT * FROM object_versions").all();

      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds)
        .toEqual(migrations.slice(migrations.indexOf(v1GoalDomainLinksMigration)).map(migration => migration.id));
      expect(db.prepare("SELECT * FROM goals ORDER BY id").all())
        .toEqual(before.map((row) => ({ ...row, parent_id: null,
          lifecycle_status: null, status_reason: null, archived_at: null, progress_mode: "automatic", progress_weight: 1, priority: "medium", horizon: null, direction_id: null })));
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(history);
      expect((await new SqliteGoalRepository(sql).findById("old"))?.domainIds).toEqual(["health"]);
      expect((await new SqliteGoalRepository(sql).findById("unlinked"))?.domainIds).toEqual([]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds).toEqual([]);
      expect(db.prepare("SELECT * FROM goal_domain_links").all())
        .toEqual([{ goal_id: "old", domain_id: "health" }]);
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
    it(`${name} saves 0..N links, keeps prior versions and rolls back failed writes`, async () => {
      const { sql, db, close } = create();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let counter = 0;
        const ids = { next: () => `item-${++counter}` };
        const domains = new SqliteLifeDomainRepository(sql);
        const goals = new SqliteGoalRepository(sql);
        const service = new GoalService(goals, domains, clock, ids);
        const life = new LifeDomainService(domains, clock, ids);
        const health = await life.create(domainDraft("健康"));
        const growth = await life.create(domainDraft("成长"));
        const other = await life.create(domainDraft("事业"));
        const created = await service.create({ ...goalDraft,
          domainIds: [health.id, growth.id, health.id] });
        expect(created.domainIds).toEqual([health.id, growth.id]);
        expect((await service.findById(created.id))?.domainIds).toEqual([health.id, growth.id]);

        await service.update(created.id, { ...created,
          title: "持续学习与休息", domainIds: [growth.id, other.id] });
        expect(await service.findById(created.id)).toMatchObject({
          title: "持续学习与休息", domainId: growth.id, domainIds: [growth.id, other.id],
        });
        const versions = await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("goal", created.id);
        expect(versions[0].snapshot.domain_ids).toEqual([health.id, growth.id]);

        const unchanged = await service.findById(created.id);
        await expect(service.update(created.id, { ...created,
          domainIds: [growth.id, "missing"] })).rejects.toThrow("关联的生活领域");
        await expect(goals.update({ ...unchanged!, title: "写入失败",
          domainIds: [growth.id, "missing"] })).rejects.toThrow();
        expect(await service.findById(created.id)).toEqual(unchanged);
        expect(await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("goal", created.id)).toHaveLength(1);
        await service.update(created.id, { ...unchanged!, domainIds: [] });
        expect(await service.findById(created.id)).toMatchObject({
          domainId: null, domainIds: [],
        });
        expect(normalizeGoalDraft({ ...goalDraft, domainId: health.id })
          .domainIds).toEqual([health.id]);
        if (db) {
          expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
          expect(db.prepare("SELECT domain_id FROM goal_domain_links WHERE goal_id = ?")
            .all(created.id)).toEqual([]);
        }
      } finally { close(); }
    });
  }
});
