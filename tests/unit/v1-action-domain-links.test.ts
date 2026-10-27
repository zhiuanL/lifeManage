import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { v1ActionDomainLinksMigration } from "../../src/db/migrations/0022-v1-action-domain-links";
import { normalizeActionDraft } from "../../src/domain/planning/Action";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { ActionService } from "../../src/services/planning/ActionService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-09-30T08:00:00Z") };
const draft = { title: "散步", notes: "", domainId: null, goalId: null, scheduledFor: "2026-09-30" };
const domainDraft = (name: string) => ({
  name, description: "", focus: "", color: "fern" as const, icon: "heart" as const,
});

describe("V1 action domain context", () => {
  it("backfills old links without rewriting action rows, plans, or completion history", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, migrations.indexOf(v1ActionDomainLinksMigration)),
        clock).run();
      const domains = new SqliteLifeDomainRepository(sql);
      await new LifeDomainService(domains, clock, { next: () => "health" })
        .create(domainDraft("健康"));
      db.prepare(`INSERT INTO actions (id, title, domain_id, status, scheduled_for,
        sort_order, completed_at, created_at, updated_at)
        VALUES ('old', '旧行动', 'health', 'completed', '2026-09-20', 0,
          '2026-09-20T08:00:00Z', '2026-09-19T08:00:00Z', '2026-09-20T08:00:00Z')`).run();
      db.prepare(`INSERT INTO actions (id, title, status, sort_order, created_at, updated_at)
        VALUES ('free', '独立行动', 'open', 1, '2026-09-19', '2026-09-19')`).run();
      const before = ["actions", "action_plan_changes", "action_state_events",
        "action_completion_plans"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());

      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds)
        .toEqual(migrations.slice(migrations.indexOf(v1ActionDomainLinksMigration)).map(migration => migration.id));
      const after = ["actions", "action_plan_changes", "action_state_events",
        "action_completion_plans"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
      expect(after).toEqual([before[0].map((row) => ({ ...row, progress_weight: 1, details_json: "{}" })), ...before.slice(1)]);
      const repository = new SqliteActionRepository(sql);
      expect((await repository.findById("old"))?.domainIds).toEqual(["health"]);
      expect((await repository.findById("free"))?.domainIds).toEqual([]);
      expect(db.prepare("SELECT * FROM action_domain_links").all())
        .toEqual([{ action_id: "old", domain_id: "health" }]);
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
    it(`${name} creates 0..N links, replaces them, and rolls back invalid edits`, async () => {
      const { sql, db, close } = create();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let counter = 0;
        const ids = { next: () => `item-${++counter}` };
        const domains = new SqliteLifeDomainRepository(sql);
        const repository = new SqliteActionRepository(sql);
        const service = new ActionService(repository, new SqliteGoalRepository(sql), domains, clock, ids);
        const life = new LifeDomainService(domains, clock, ids);
        const health = await life.create(domainDraft("健康"));
        const work = await life.create(domainDraft("事业"));
        const growth = await life.create(domainDraft("成长"));
        const action = await service.create({ ...draft,
          domainIds: [health.id, work.id, health.id] });
        expect((await repository.findById(action.id))?.domainIds).toEqual([health.id, work.id]);
        const changed = await service.update(action.id, { ...action,
          domainIds: [work.id, growth.id], scheduledFor: "2026-10-01" },
        { reason: "personal", note: "" });
        expect(await repository.findById(action.id)).toMatchObject({
          domainId: work.id, domainIds: [work.id, growth.id], scheduledFor: "2026-10-01",
        });
        const completed = await service.toggleCompletion(action.id);
        const before = {
          action: await repository.findById(action.id),
          plans: await repository.listPlanChanges(),
          events: await repository.listStateEvents(),
          completions: await repository.listCompletionPlans(),
        };
        await expect(service.update(action.id, { ...changed, domainIds: [growth.id, "missing"] }))
          .rejects.toThrow("关联的生活领域");
        await expect(repository.updatePlan({ ...completed, title: "写入失败",
          domainId: growth.id, domainIds: [growth.id, "missing"],
          scheduledFor: "2026-10-03", updatedAt: "2026-10-03T08:00:00Z" },
        { reason: "external", note: "" })).rejects.toThrow();
        expect({
          action: await repository.findById(action.id),
          plans: await repository.listPlanChanges(),
          events: await repository.listStateEvents(),
          completions: await repository.listCompletionPlans(),
        }).toEqual(before);
        await expect(repository.update({ ...completed, id: "missing", domainId: null,
          domainIds: [] })).rejects.toThrow();
        expect((await repository.findById(action.id))?.status).toBe("completed");
        await service.update(action.id, { ...completed, domainIds: [] });
        expect(await repository.findById(action.id)).toMatchObject({
          domainId: null, domainIds: [],
        });
        expect(normalizeActionDraft({ ...draft, domainId: health.id }).domainIds).toEqual([health.id]);
        if (db) expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { close(); }
    });
  }
});
