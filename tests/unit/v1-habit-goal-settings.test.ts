import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { calculateGoalProgress } from "../../src/domain/progress/GoalProgress";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { GoalProgressItemService } from "../../src/services/planning/GoalProgressItemService";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteHabitRepository } from "../../src/repositories/sqlite/SqliteHabitRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { GoalService } from "../../src/services/planning/GoalService";
import { HabitService } from "../../src/services/habits/HabitService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-10-10T08:00:00Z") };
const draft = { title: "恢复稳定作息", description: "", domainId: null, status: "active" as const, targetDate: null };
const habitDraft = { title: "散步", intention: "", weeklyTarget: 7, stableContext: "",
  triggerCondition: "", obstacle: "", adjustment: "", startOn: "2026-09-28", domainIds: [] };

describe("V1 persisted habit goal settings", () => {
  it("migrates V27 without changing records and accepts old backups", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 27), clock).run();
      db.exec("INSERT INTO goals (id, title, status, sort_order, created_at, updated_at) VALUES ('old', '原目标', 'active', 0, '2026-10-09', '2026-10-09')");
      const old = db.prepare("SELECT * FROM goals").all();
      await new MigrationRunner(sql, migrations.slice(0, 28), clock).run();
      expect(db.prepare("SELECT * FROM goals").all()).toEqual(old);
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual([]);
      const backup = { format: "lifeos-backup", schemaVersion: 28, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(backupTables.slice(0, 34).map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])) };
      expect(inspectBackup(backup).counts.goal_habit_progress).toBe(0);
      const legacy = structuredClone(backup);
      legacy.schemaVersion = 27;
      delete legacy.data.goal_habit_progress;
      expect(inspectBackup(legacy).counts.goals).toBe(1);
      const bad = structuredClone(backup);
      bad.data.goal_habit_progress = [{ goal_id: "old", habit_id: "missing", start_on: "2026-09-28",
        end_on: "2026-10-04", weekly_target: 3, weight: 1, sort_order: 0 }];
      expect(() => inspectBackup(bad)).toThrow("关联");
    } finally { db.close(); }
  });

  for (const mode of ["SQLite", "preview"] as const) {
    it(`${mode} saves settings, keeps old callers compatible, and preserves facts and history atomically`, async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      db?.exec("PRAGMA foreign_keys = ON");
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let seq = 0;
        const ids = { next: () => `habit-goal-${++seq}` };
        const domains = new SqliteLifeDomainRepository(sql);
        const habitRepo = new SqliteHabitRepository(sql);
        const habits = new HabitService(habitRepo, domains, clock, ids);
        const repo = new SqliteGoalRepository(sql);
        const goals = new GoalService(repo, domains, clock, ids, habitRepo);
        const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
        const first = await habits.create(habitDraft);
        const second = await habits.create({ ...habitDraft, title: "阅读" });
        await habits.saveLog(first.id, "2026-09-28", true);
        await habits.saveLog(second.id, "2026-09-29", true);
        const settings = [
          { habitId: first.id, startOn: "2026-09-28", endOn: "2026-10-04", weeklyTarget: 2, weight: 1 },
          { habitId: second.id, startOn: "2026-09-28", endOn: "2026-10-04", weeklyTarget: 1, weight: 3 },
        ];
        const goal = await goals.create({ ...draft, habitProgress: settings });
        expect((await goals.findById(goal.id))?.habitProgress).toEqual(settings);
        if (db) {
          const backup = { format: "lifeos-backup", schemaVersion: 28, appVersion: "0.1.0", exportedAt: clock.now().toISOString(), data: Object.fromEntries(backupTables.slice(0, 34).map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])) };
          expect(inspectBackup(backup).counts.goal_habit_progress).toBe(2);
          for (const changes of [{ weekly_target: 0 }, { weight: 0 }, { start_on: "2026-02-30" }, { sort_order: -1 }]) {
            const bad = structuredClone(backup);
            Object.assign(bad.data.goal_habit_progress[0], changes);
            expect(() => inspectBackup(bad)).toThrow();
          }
          const duplicate = structuredClone(backup);
          duplicate.data.goal_habit_progress.push({ ...duplicate.data.goal_habit_progress[0] });
          expect(() => inspectBackup(duplicate)).toThrow();
        }
        const progress = new GoalProgressItemService(new SqliteGoalProgressItemRepository(sql), repo, clock, ids);
        await progress.replace(goal.id, [{ kind: "milestone", title: "保留的节点", targetValue: 1, currentValue: 0, weight: 1 }]);
        expect((await history.list("goal", goal.id))[0].snapshot.habit_progress).toHaveLength(2);
        const logs = await habits.listLogs();
        const context = { habits: await habits.list(), logs, today: "2026-10-10" };
        expect(calculateGoalProgress([goal], [], [], context).get(goal.id)?.percent).toBe(88);
        expect(calculateGoalProgress([goal], []).get(goal.id)?.percent).toBeNull();
        const parent = await goals.create(draft);
        const child = await goals.update(goal.id, { ...draft, parentId: parent.id });
        expect(child.habitProgress).toEqual(settings);
        expect(calculateGoalProgress([parent, child], [], [], context).get(parent.id)?.percent).toBe(88);
        await goals.update(goal.id, { ...child, habitProgress: settings.map((item) => ({ ...item, weight: 2 })) });
        expect((await history.list("goal", goal.id))[0].snapshot.habit_progress).toEqual(settings.map((item, sort_order) => ({
          habit_id: item.habitId, start_on: item.startOn, end_on: item.endOn,
          weekly_target: item.weeklyTarget, weight: item.weight, sort_order,
        })));
        const before = await repo.findById(goal.id);
        const versions = await history.list("goal", goal.id);
        await expect(repo.update({ ...child, title: "不应写入", habitProgress: [{ ...settings[0], habitId: "missing" }] })).rejects.toThrow();
        expect(await repo.findById(goal.id)).toEqual(before);
        expect(await history.list("goal", goal.id)).toEqual(versions);
        await goals.update(goal.id, { ...child, habitProgress: null, progressMode: "exploration" });
        expect((await goals.findById(goal.id))?.habitProgress).toBeNull();
        expect(await habits.listLogs()).toEqual(logs);
        expect((await habits.list())[0].weeklyTarget).toBe(7);
        await expect(goals.create({ ...draft, habitProgress: [] })).rejects.toThrow("1 至 30");
        await expect(goals.create({ ...draft, habitProgress: settings, progressMode: "exploration" })).rejects.toThrow("探索型");
        await expect(goals.create({ ...draft, habitProgress: [{ ...settings[0], habitId: "missing" }] })).rejects.toThrow("习惯");
      } finally { db?.close(); }
    });
  }
});
