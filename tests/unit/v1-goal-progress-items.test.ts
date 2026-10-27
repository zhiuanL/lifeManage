import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { v1GoalProgressItemsMigration } from "../../src/db/migrations/0025-v1-goal-progress-items";
import { inspectBackup, backupTables, type LifeOSBackup } from "../../src/domain/backup/Backup";
import { calculateGoalProgress } from "../../src/domain/progress/GoalProgress";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { GoalProgressItemService } from "../../src/services/planning/GoalProgressItemService";
import { GoalService } from "../../src/services/planning/GoalService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-09-30T08:00:00Z") };
const draft = { title: "保持节奏", description: "", domainId: null,
  status: "active" as const, targetDate: null };
const kr = { kind: "key_result" as const, title: "规律休息", targetValue: 10,
  currentValue: 4, weight: 3 };

describe("V1 goal progress items", () => {
  it("adds the progress table without modifying existing goals or history", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 24), clock).run();
      db.prepare(`INSERT INTO goals (id, title, status, sort_order, created_at, updated_at)
        VALUES ('old', '原有目标', 'active', 0, '2026-09-29', '2026-09-29')`).run();
      const old = db.prepare("SELECT * FROM goals").get();
      const history = db.prepare("SELECT * FROM object_versions").all();
      expect((await new MigrationRunner(sql, migrations.slice(0, 25), clock).run()).appliedMigrationIds)
        .toEqual([v1GoalProgressItemsMigration.id]);
      expect(db.prepare("SELECT * FROM goals").get()).toEqual(old);
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(history);
      expect(db.prepare("SELECT * FROM goal_progress_items").all()).toEqual([]);
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
    it(`${name} saves weighted progress, versions, and rolls back invalid changes`, async () => {
      const { sql, db, close } = create();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let sequence = 0;
        const ids = { next: () => `item-${++sequence}` };
        const goals = new SqliteGoalRepository(sql);
        const goalService = new GoalService(goals, new SqliteLifeDomainRepository(sql), clock, ids);
        const service = new GoalProgressItemService(
          new SqliteGoalProgressItemRepository(sql), goals, clock, ids);
        const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
        const goal = await goalService.create(draft);
        const first = await service.replace(goal.id, [
          kr, { kind: "milestone", title: "阶段目标", targetValue: 2, currentValue: 3, weight: 1 },
        ]);
        expect(first.map((item) => item.sortOrder)).toEqual([0, 1]);
        expect(calculateGoalProgress(await goalService.list(), [], first)
          .get(goal.id)?.percent).toBe(55);
        expect((await history.list("goal", goal.id))[0].snapshot.progress_items).toEqual([]);

        const next = await service.replace(goal.id, [
          { ...first[0], currentValue: 10 }, first[1],
        ]);
        expect(next[0].id).toBe(first[0].id);
        expect(next[0].createdAt).toBe(first[0].createdAt);
        expect(calculateGoalProgress(await goalService.list(), [], next)
          .get(goal.id)?.percent).toBe(100);
        expect((await history.list("goal", goal.id))[0].snapshot.progress_items)
          .toEqual(first.map((item) => ({
            id: item.id, kind: item.kind, title: item.title,
            target_value: item.targetValue, current_value: item.currentValue,
            weight: item.weight, sort_order: item.sortOrder,
          })));
        await goalService.update(goal.id, { ...draft, title: "改名后的目标" });
        expect((await history.list("goal", goal.id))[0].snapshot.progress_items)
          .toHaveLength(2);
        const unchanged = await service.list();
        const versionCount = (await history.list("goal", goal.id)).length;
        await service.replace(goal.id, next);
        expect(await history.list("goal", goal.id)).toHaveLength(versionCount);
        await expect(service.replace(goal.id, [{ ...kr, targetValue: 0 }]))
          .rejects.toThrow();
        await expect(service.replace(goal.id, [{ ...kr, weight: Infinity }]))
          .rejects.toThrow();
        await expect(service.replace(goal.id, [{ ...kr, id: "foreign" }]))
          .rejects.toThrow();
        await expect(service.replace("missing", [kr])).rejects.toThrow();
        expect(await service.list()).toEqual(unchanged);
        expect(await history.list("goal", goal.id)).toHaveLength(versionCount);

        if (db) {
          const duplicate = { ...next[1], id: next[0].id };
          const preFailure = db.prepare("SELECT * FROM goals WHERE id = ?").get(goal.id);
          await expect(new SqliteGoalProgressItemRepository(sql)
            .replace(goal.id, [next[0], duplicate], clock.now().toISOString()))
            .rejects.toThrow();
          expect(await service.list()).toEqual(unchanged);
          expect(db.prepare("SELECT * FROM goals WHERE id = ?").get(goal.id))
            .toEqual(preFailure);
          expect(await history.list("goal", goal.id)).toHaveLength(versionCount);
          expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        }
        await service.replace(goal.id, []);
        expect(await service.list()).toEqual([]);
        expect(calculateGoalProgress(await goalService.list(), [], []).get(goal.id)?.percent)
          .toBeNull();
      } finally { close(); }
    });
  }

  it("preflights progress items and still accepts version 24 without them", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      await new MigrationRunner(nativeSqliteExecutor(db), migrations, clock).run();
      const backup = {
        format: "lifeos-backup", schemaVersion: 25, appVersion: "0.1.0",
        exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(backupTables.slice(0, 33).map((table) =>
          [table, db.prepare(`SELECT * FROM ${table}`).all()])),
      } as LifeOSBackup;
      backup.data.goals.push({
        id: "goal", title: "目标", description: "", domain_id: null, parent_id: null,
        status: "active", sort_order: 0, target_date: null, completed_at: null,
        created_at: clock.now().toISOString(), updated_at: clock.now().toISOString(),
        privacy_level: "private",
      });
      backup.data.goal_progress_items.push({
        id: "progress", goal_id: "goal", kind: "key_result", title: "成果",
        target_value: 10, current_value: 3, weight: 1, sort_order: 0,
        created_at: clock.now().toISOString(), updated_at: clock.now().toISOString(),
      });
      expect(inspectBackup(backup).counts.goal_progress_items).toBe(1);
      const invalid = structuredClone(backup);
      invalid.data.goal_progress_items[0].goal_id = "missing";
      expect(() => inspectBackup(invalid)).toThrow("目标进度项");
      invalid.data.goal_progress_items[0].goal_id = "goal";
      invalid.data.goal_progress_items[0].weight = 0;
      expect(() => inspectBackup(invalid)).toThrow("目标进度项");
      const v24 = structuredClone(backup);
      v24.schemaVersion = 24;
      delete v24.data.goal_progress_items;
      expect(inspectBackup(v24).counts.goal_progress_items).toBe(0);
    } finally { db.close(); }
  });
});
