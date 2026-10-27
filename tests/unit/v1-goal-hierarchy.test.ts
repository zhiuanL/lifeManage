import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { v1GoalHierarchyMigration } from "../../src/db/migrations/0024-v1-goal-hierarchy";
import { backupTables, inspectBackup, type LifeOSBackup } from "../../src/domain/backup/Backup";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { GoalService } from "../../src/services/planning/GoalService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-09-30T08:00:00Z") };
const draft = {
  title: "年度方向", description: "", domainId: null,
  status: "active" as const, targetDate: null,
};

describe("V1 goal hierarchy", () => {
  it("adds an optional parent without modifying old goals or version history", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0,
        migrations.indexOf(v1GoalHierarchyMigration)), clock).run();
      db.prepare(`INSERT INTO goals (id, title, status, sort_order, created_at, updated_at)
        VALUES ('old', '旧目标', 'active', 0, '2026-09-29', '2026-09-29')`).run();
      const old = db.prepare("SELECT * FROM goals").get();
      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds)
        .toEqual(migrations.slice(migrations.indexOf(v1GoalHierarchyMigration)).map(migration => migration.id));
      expect(db.prepare("SELECT * FROM goals").get()).toEqual({ ...old, parent_id: null,
        lifecycle_status: null, status_reason: null, archived_at: null, progress_mode: "automatic", progress_weight: 1, priority: "medium", horizon: null, direction_id: null });
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual([]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
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
    it(`${name} saves hierarchy and rejects cycles and missing parents`, async () => {
      const { sql, db, close } = create();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let sequence = 0;
        const repository = new SqliteGoalRepository(sql);
        const service = new GoalService(repository, new SqliteLifeDomainRepository(sql),
          clock, { next: () => `goal-${++sequence}` });
        const root = await service.create(draft);
        const child = await service.create({ ...draft, title: "季度方向", parentId: root.id });
        const leaf = await service.create({ ...draft, title: "月度方向", parentId: child.id });
        expect((await service.list()).map((goal) => goal.parentId)).toEqual([
          null, root.id, child.id,
        ]);
        await expect(service.update(root.id, { ...root, parentId: leaf.id }))
          .rejects.toThrow("循环");
        await expect(service.update(child.id, { ...child, parentId: child.id }))
          .rejects.toThrow("循环");
        await expect(service.create({ ...draft, parentId: "missing" }))
          .rejects.toThrow("不存在");
        expect((await service.findById(root.id))?.parentId).toBeNull();
        const changed = await service.update(leaf.id, { ...leaf, parentId: root.id });
        expect(changed.parentId).toBe(root.id);
        expect((await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("goal", leaf.id))[0]
          .snapshot.parent_id).toBe(child.id);
        await service.update(leaf.id, { ...draft, title: leaf.title, parentId: null });
        expect((await service.findById(leaf.id))?.parentId).toBeNull();
        if (db) {
          expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
          expect(() => db.prepare("UPDATE goals SET parent_id = id WHERE id = ?")
            .run(root.id)).toThrow();
          const backup = {
            format: "lifeos-backup", schemaVersion: 25, appVersion: "0.1.0",
            exportedAt: clock.now().toISOString(),
            data: Object.fromEntries(backupTables.slice(0, 33).map((table) =>
              [table, db.prepare(`SELECT * FROM ${table}`).all()])),
          } as LifeOSBackup;
          expect(inspectBackup(backup).counts.goals).toBe(3);
          const cyclic = structuredClone(backup);
          const rows = cyclic.data.goals;
          rows.find((row) => row.id === root.id)!.parent_id = child.id;
          expect(() => inspectBackup(cyclic)).toThrow("循环");
          rows.find((row) => row.id === root.id)!.parent_id = "missing";
          expect(() => inspectBackup(cyclic)).toThrow("不存在");
          const v24 = structuredClone(backup);
          v24.schemaVersion = 24;
          delete v24.data.goal_progress_items;
          expect(inspectBackup(v24).counts.goals).toBe(3);
          const v23 = structuredClone(backup);
          v23.schemaVersion = 23;
          delete v23.data.goal_progress_items;
          for (const row of v23.data.goals) delete row.parent_id;
          expect(inspectBackup(v23).counts.goals).toBe(3);
        }
      } finally { close(); }
    });
  }
});
