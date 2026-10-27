import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { domainHistoryBackupTables, identityRoleBackupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { buildDomainTimeline, type DomainChange, type DomainHistorySnapshot } from "../../src/domain/life/DomainHistory";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteDomainHistoryRepository } from "../../src/repositories/sqlite/SqliteDomainHistoryRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { DomainTimelineService } from "../../src/services/history/DomainTimelineService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { GoalService } from "../../src/services/planning/GoalService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const first = "2026-10-20T08:00:00.000Z";
const second = "2026-10-22T08:00:00.000Z";
const before: DomainHistorySnapshot = { name: "健康", description: "原说明", focus: "",
  color_key: "fern", icon_key: "heart", current_state: "", long_term_expectation: "", status: "active" };
const change: DomainChange = { id: 1, domainId: "domain /?#", changedAt: second, before,
  after: { ...before, name: "健康与体能", current_state: "  原文\n保留  ", status: "paused" } };

describe("V1 explicit domain history facts", () => {
  it("rolls back a failed history migration without changing old domain records", async () => {
    const db = new DatabaseSync(":memory:");
    const clock = { now: () => new Date(first) };
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 47), clock).run();
      const domains = new LifeDomainService(new SqliteLifeDomainRepository(sql), clock, { next: () => "preserved" });
      await domains.create({ name: "健康", description: "原说明", focus: "",
        color: "fern", icon: "heart" });
      const old = db.prepare("SELECT * FROM life_domains").all();
      const migration = migrations[47];
      const broken = [...migrations.slice(0, 47), { ...migration,
        statements: [...migration.statements, "INSERT INTO missing_domain_table VALUES (1)"] }];
      await expect(new MigrationRunner(sql, broken, clock).run()).rejects.toThrow();
      expect(db.prepare("SELECT * FROM life_domains").all()).toEqual(old);
      expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get())
        .toMatchObject({ version: "0047-v1-domain-templates" });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'life_domain_versions'").all()).toEqual([]);
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM life_domains").all()).toEqual(old);
      expect(await new SqliteDomainHistoryRepository(sql).listChanges()).toEqual([]);
    } finally { db.close(); }
  });
  it("keeps before/after text, original date and scope without mutating inputs", () => {
    const saved = JSON.stringify(change);
    expect(buildDomainTimeline([change])).toMatchObject([{ id: "domain-change-1",
      domainId: change.domainId, changedAt: second, title: "健康与体能" }]);
    expect(buildDomainTimeline([change])[0].detail).toContain("活跃 → 暂停");
    expect(buildDomainTimeline([change])[0].change.after.current_state).toBe("  原文\n保留  ");
    expect(JSON.stringify(change)).toBe(saved);
    expect(buildDomainTimeline([])).toEqual([]);
    expect(buildDomainTimeline([{ ...change, after: before }])).toEqual([]);
  });
  it("preserves undo facts and sorts equal timestamps by causal IDs", () => {
    const undo = { ...change, id: 2, before: change.after, after: before };
    expect(buildDomainTimeline([change, undo]).map(entry => entry.id))
      .toEqual(["domain-change-2", "domain-change-1"]);
  });
  it("rejects invalid dates, identifiers, partial or unknown fields and duplicate history IDs", () => {
    for (const invalid of [
      { ...change, id: 0 }, { ...change, domainId: "" },
      { ...change, changedAt: "2026-02-30T08:00:00Z" },
      { ...change, changedAt: "2026-10-22T24:00:00Z" },
      { ...change, after: { ...change.after, status: "unknown" } },
      { ...change, after: { ...change.after, name: "😀".repeat(15) } },
      { ...change, after: { ...change.after, unknown: "extra" } },
      { ...change, after: {} as DomainHistorySnapshot },
    ]) expect(() => buildDomainTimeline([invalid])).toThrow();
    expect(() => buildDomainTimeline([change, change])).toThrow();
  });
  it("propagates repository failures without returning partial facts", async () => {
    const listChanges = vi.fn().mockRejectedValue(new Error("private database failure"));
    await expect(new DomainTimelineService({ listChanges }).list()).rejects.toThrow();
  });
});

for (const mode of ["SQLite", "memory"] as const) {
  describe(`V1 domain change persistence in ${mode}`, () => {
    it("preserves old data and links, starts history after migration, ignores no-op/reorder and rolls back changes", async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      const executor = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      let now = first;
      const clock = { now: () => new Date(now) };
      let sequence = 0;
      const ids = { next: () => `domain-history-${++sequence}` };
      try {
        if (db) db.exec("PRAGMA foreign_keys=ON");
        await new MigrationRunner(executor, migrations.slice(0, 47), clock).run();
        const repository = new SqliteLifeDomainRepository(executor);
        const domains = new LifeDomainService(repository, clock, ids);
        const draft = { name: "健康", description: "原说明", focus: "", color: "fern" as const, icon: "heart" as const };
        const domain = await domains.create(draft);
        const goals = new GoalService(new SqliteGoalRepository(executor), repository, clock, ids);
        const goal = await goals.create({ title: "慢慢活动", description: "", domainId: domain.id,
          status: "active", targetDate: null });
        await domains.update(domain.id, { ...draft, currentState: "迁移前状态" });
        const preserved = await domains.findById(domain.id);
        await new MigrationRunner(executor, migrations.slice(0, 48), clock).run();
        const history = new SqliteDomainHistoryRepository(executor);
        expect(await history.listChanges()).toEqual([]);
        expect(await domains.findById(domain.id)).toEqual(preserved);
        now = second;
        await domains.update(domain.id, { ...draft, name: "健康与体能", currentState: "舒适活动", status: "paused" });
        let list = await history.listChanges();
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ domainId: domain.id, changedAt: second,
          before: { name: "健康", current_state: "迁移前状态", status: "active" },
          after: { name: "健康与体能", current_state: "舒适活动", status: "paused" } });
        now = "2026-10-22T09:00:00.000Z";
        await domains.update(domain.id, { ...draft, name: "健康与体能", currentState: "舒适活动", status: "paused" });
        await domains.reorder((await domains.list()).map(item => item.id).reverse());
        expect(await history.listChanges()).toEqual(list);
        expect((await goals.list()).find(item => item.id === goal.id)?.domainIds).toContain(domain.id);
        const current = (await domains.findById(domain.id))!;
        await executor.execute("BEGIN IMMEDIATE");
        await repository.update({ ...current, status: "archived" });
        expect(await history.listChanges()).toHaveLength(2);
        await executor.execute("ROLLBACK");
        expect(await history.listChanges()).toEqual(list);
        expect((await domains.findById(domain.id))?.status).toBe("paused");
        const service = new DomainTimelineService(new SqliteDomainHistoryRepository(executor));
        const entries = await service.list();
        expect(entries).toHaveLength(1);
        list = await history.listChanges();
        expect(list).toHaveLength(1);
        await expect(repository.update({ ...current, id: "missing" })).rejects.toThrow("领域已变化");
        if (db) {
          expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
          expect(() => db.prepare("DELETE FROM life_domains WHERE id = ?").run(domain.id)).toThrow();
          const data = Object.fromEntries(domainHistoryBackupTables.map(table =>
            [table, db.prepare(`SELECT * FROM ${table}`).all()]));
          const backup = { format: "lifeos-backup", schemaVersion: 48, appVersion: "test", exportedAt: second, data };
          expect(inspectBackup(backup).counts.life_domain_versions).toBe(1);
          const legacy = { ...backup, schemaVersion: 47,
            data: Object.fromEntries(identityRoleBackupTables.map(table => [table, data[table]])) };
          expect(inspectBackup(legacy).counts.life_domain_versions).toBe(0);
          expect(() => inspectBackup({ ...backup, schemaVersion: 47 })).toThrow();
          for (const invalid of [
            { ...data.life_domain_versions[0], domain_id: "missing" },
            { ...data.life_domain_versions[0], changed_at: "2026-02-30T08:00:00Z" },
            { ...data.life_domain_versions[0], before_json: "[]" },
            { ...data.life_domain_versions[0], id: 0 },
          ]) expect(() => inspectBackup({ ...backup,
            data: { ...data, life_domain_versions: [invalid] } })).toThrow();
          expect(() => inspectBackup({ ...backup,
            data: { ...data, life_domain_versions: [...data.life_domain_versions, ...data.life_domain_versions] } })).toThrow();
        }
      } finally { db?.close(); }
    });
  });
}
