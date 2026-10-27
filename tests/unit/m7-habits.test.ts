import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { inspectBackup, backupTables, type BackupRow, type LifeOSBackup } from "../../src/domain/backup/Backup";
import { summarizeHabit } from "../../src/domain/habits/Habit";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import { SqliteHabitRepository } from "../../src/repositories/sqlite/SqliteHabitRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { HabitService } from "../../src/services/habits/HabitService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";

const clock = { now: () => new Date("2026-09-29T08:00:00Z") };
let sequence = 0;
const ids = { next: () => `habit-test-${++sequence}` };
const draft = {
  title: "晚间散步", intention: "轻松散步", weeklyTarget: 3,
  stableContext: "晚饭后", triggerCondition: "放下碗筷",
  obstacle: "", adjustment: "", startOn: "2026-09-15", domainIds: [] as string[],
};

function native(db: DatabaseSync): SqliteExecutor {
  return nativeSqliteExecutor(db);
}

async function setup(sql: SqliteExecutor) {
  await new MigrationRunner(sql, migrations, clock).run();
  const domains = new SqliteLifeDomainRepository(sql);
  return {
    domains: new LifeDomainService(domains, clock, ids),
    repository: new SqliteHabitRepository(sql),
    habits: new HabitService(new SqliteHabitRepository(sql), domains, clock, ids),
  };
}

describe("M7 habit facts and rules", () => {
  for (const [label, create] of [
    ["preview", () => ({ sql: new MemorySqliteExecutor(), close: () => {} })],
    ["SQLite", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("PRAGMA foreign_keys=ON");
      return { sql: native(db), close: () => db.close() };
    }],
  ] as const) {
    it(`${label} persists logs, edits, and multi-domain context without judging a partial first week`, async () => {
      const { sql, close } = create();
      try {
        const { domains, habits } = await setup(sql);
        const a = await domains.create({ name: "健康", description: "", focus: "", color: "fern", icon: "heart" });
        const b = await domains.create({ name: "关系", description: "", focus: "", color: "coral", icon: "users" });
        const habit = await habits.create({ ...draft, domainIds: [a.id, b.id] });
        await habits.saveLog(habit.id, "2026-09-22", true);
        await habits.saveLog(habit.id, "2026-09-23", true);
        await habits.saveLog(habit.id, "2026-09-24", true);
        await habits.saveLog(habit.id, "2026-09-29", true, "下雨", "室内走动");
        const loaded = (await habits.list()).find((item) => item.id === habit.id)!;
        expect(loaded.domainIds).toEqual([a.id, b.id].sort());
        expect(summarizeHabit(loaded, await habits.listLogs(), "2026-09-29"))
          .toMatchObject({ currentWeek: 1, eligibleWeeks: 1, completionRate: 100, consecutiveWeeks: 1 });
        const changed = await habits.saveLog(habit.id, "2026-09-22", false);
        expect(changed.completed).toBe(false);
        expect((await habits.listLogs()).filter((item) => item.habitId === habit.id)).toHaveLength(4);
        expect(summarizeHabit(loaded, await habits.listLogs(), "2026-09-29"))
          .toMatchObject({ completionRate: 67, consecutiveWeeks: 0 });
        await expect(habits.update(habit.id, { ...draft, startOn: "2026-09-25" }))
          .rejects.toThrow("打卡日期");
        await habits.update(habit.id, { ...draft, domainIds: [b.id] });
        expect((await habits.list())[0].domainIds).toEqual([b.id]);
        await habits.setArchived(habit.id, true);
        await expect(habits.saveLog(habit.id, "2026-09-28", true)).rejects.toThrow("归档");
        await habits.setArchived(habit.id, false);
        await expect(habits.saveLog(habit.id, "2026-09-30", true)).rejects.toThrow("日期");
        await expect(habits.create({ ...draft, weeklyTarget: 8 })).rejects.toThrow("1 至 7");
      } finally { close(); }
    });
  }

  it("rolls back a failed multi-domain update in the preview executor", async () => {
    const sql = new MemorySqliteExecutor();
    const { domains, habits, repository } = await setup(sql);
    const a = await domains.create({ name: "健康", description: "", focus: "", color: "fern", icon: "heart" });
    const habit = await habits.create({ ...draft, domainIds: [a.id] });
    await expect(repository.update({ ...habit, title: "不能保存", domainIds: [a.id, "missing"] }))
      .rejects.toThrow("Invalid habit link");
    expect((await habits.list())[0]).toMatchObject({ title: "晚间散步", domainIds: [a.id] });
  });

  it("migrates existing M6 rows forward and checks real SQLite constraints", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const sql = native(db);
      await new MigrationRunner(sql, migrations.slice(0, 16), clock).run();
      db.prepare(`INSERT INTO life_domains
        (id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at)
        VALUES ('old-domain', '已有领域', '', '', 'fern', 'heart', 0, '2026-09-20', '2026-09-20')`).run();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT name FROM life_domains WHERE id = 'old-domain'").get())
        .toMatchObject({ name: "已有领域" });
      const { habits } = await setup(sql);
      const created = await habits.create({ ...draft, domainIds: ["old-domain"] });
      await habits.saveLog(created.id, "2026-09-27", true);
      expect(() => db.prepare(`INSERT INTO habit_logs
        (id, habit_id, recorded_on, completed, created_at, updated_at)
        VALUES ('invalid', ?, '2026-09-27', 1, 'now', 'now')`).run(created.id)).toThrow();
      expect(() => db.prepare(`INSERT INTO habit_domain_links
        (habit_id, domain_id) VALUES (?, 'absent')`).run(created.id)).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
      const backup: LifeOSBackup = {
        format: "lifeos-backup", schemaVersion: 17, appVersion: "0.1.0",
        exportedAt: "2026-09-29T08:00:00Z",
        data: Object.fromEntries(backupTables.slice(0, 21).map((table) =>
          [table, db.prepare(`SELECT * FROM ${table}`).all() as BackupRow[]])) as LifeOSBackup["data"],
      };
      expect(inspectBackup(backup).counts.habit_logs).toBe(1);
      const broken = structuredClone(backup);
      (broken.data.habit_domain_links as BackupRow[])[0].domain_id = "missing";
      expect(() => inspectBackup(broken)).toThrow("引用");
      const legacy = structuredClone(backup);
      legacy.schemaVersion = 16;
      for (const table of ["habits", "habit_domain_links", "habit_logs"] as const) {
        delete (legacy.data as Partial<typeof legacy.data>)[table];
      }
      expect(inspectBackup(legacy).counts.habits).toBe(0);
      expect(() => inspectBackup({ ...legacy, schemaVersion: 17 })).toThrow("数据表");
    } finally { db.close(); }
  });
});
