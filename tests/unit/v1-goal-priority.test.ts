import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { normalizeGoalPriority } from "../../src/domain/planning/GoalPriority";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { GoalService } from "../../src/services/planning/GoalService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const draft = { title: "目标", description: "", domainId: null, status: "active" as const, targetDate: null };
describe("V1 goal priority", () => {
  it("defaults to medium and rejects unknown levels", () => {
    expect(normalizeGoalPriority(undefined)).toBe("medium");
    for (const value of ["", null, "urgent", 1]) expect(() => normalizeGoalPriority(value as never)).toThrow();
    for (const value of ["high", "medium", "low"] as const) expect(normalizeGoalPriority(value)).toBe(value);
  });
  for (const mode of ["SQLite", "preview"] as const) {
    it(mode + " preserves omitted priority and captures previous facts", async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      db?.exec("PRAGMA foreign_keys = ON");
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let sequence = 0;
        const goals = new GoalService(new SqliteGoalRepository(sql), new SqliteLifeDomainRepository(sql), clock, { next: () => "priority-" + ++sequence });
        const goal = await goals.create(draft);
        expect(goal.priority).toBe("medium");
        await goals.update(goal.id, { ...draft, priority: "high" });
        expect((await goals.findById(goal.id))?.priority).toBe("high");
        await goals.update(goal.id, { ...draft, title: "仅标题" });
        expect((await goals.findById(goal.id))?.priority).toBe("high");
        expect((await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("goal", goal.id)).map((v) => v.snapshot.priority)).toEqual(["high", "medium"]);
        await expect(goals.update(goal.id, { ...draft, priority: "urgent" as never })).rejects.toThrow();
        expect((await goals.findById(goal.id))?.title).toBe("仅标题");
      } finally { db?.close(); }
    });
  }
  it("migrates V29 without changing existing facts and validates V30 backups", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 29), clock).run();
      db.exec("INSERT INTO goals (id,title,status,sort_order,created_at,updated_at) VALUES ('old','旧目标','active',0,'2026-10-10','2026-10-10')");
      const before = db.prepare("SELECT * FROM goals").get();
      await new MigrationRunner(sql, migrations, clock).run();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM goals").get()).toEqual({ ...before, priority: "medium", horizon: null, direction_id: null });
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual([]);
      const backup = { format: "lifeos-backup", schemaVersion: 30, appVersion: "0.1.0", exportedAt: clock.now().toISOString(), data: Object.fromEntries(backupTables.slice(0, 34).map((table) => [table, db.prepare("SELECT * FROM " + table).all()])) };
      expect(inspectBackup(backup).counts.goals).toBe(1);
      for (const value of [null, "urgent", 1]) {
        const invalid = structuredClone(backup); invalid.data.goals[0].priority = value;
        expect(() => inspectBackup(invalid)).toThrow();
      }
      const legacy = structuredClone(backup); legacy.schemaVersion = 29; delete legacy.data.goals[0].priority;
      expect(inspectBackup(legacy).counts.goals).toBe(1);
      expect(() => db.exec("UPDATE goals SET priority='urgent'")).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});
