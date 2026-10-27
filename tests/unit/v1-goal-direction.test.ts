import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { goalHorizons, normalizeGoalHorizon } from "../../src/domain/planning/GoalHorizon";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteLifeNavigationRepository } from "../../src/repositories/sqlite/SqliteLifeNavigationRepository";
import { GoalService } from "../../src/services/planning/GoalService";
import { LifeNavigationService } from "../../src/services/life/LifeNavigationService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const draft = { title: "目标", description: "", domainId: null, status: "active" as const, targetDate: null };
describe("V1 goal horizon and long-term direction", () => {
  it("keeps old goals unclassified and rejects unsupported horizons", () => {
    expect(normalizeGoalHorizon()).toBeNull();
    expect(normalizeGoalHorizon(null)).toBeNull();
    for (const horizon of goalHorizons) expect(normalizeGoalHorizon(horizon)).toBe(horizon);
    for (const invalid of ["", "weekly", 1]) expect(() => normalizeGoalHorizon(invalid as never)).toThrow();
  });
  for (const mode of ["SQLite", "preview"]) it(mode + " validates direction and preserves omitted fields and history", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    db?.exec("PRAGMA foreign_keys=ON");
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      await new MigrationRunner(sql, migrations, clock).run();
      let sequence = 0;
      const ids = { next: () => "direction-" + ++sequence };
      const navigation = new SqliteLifeNavigationRepository(sql);
      const life = new LifeNavigationService(navigation, clock, ids);
      const goals = new GoalService(new SqliteGoalRepository(sql), new SqliteLifeDomainRepository(sql), clock, ids, undefined, navigation);
      await expect(goals.create({ ...draft, horizon: "annual" })).rejects.toThrow("长期方向");
      const vision = await life.create("vision", { title: "持续成长", description: "" });
      const principle = await life.create("principle", { title: "保持诚实", description: "" });
      for (const directionId of ["missing", principle.id]) await expect(goals.create({ ...draft, directionId })).rejects.toThrow();
      const annual = await goals.create({ ...draft, horizon: "annual", directionId: vision.id });
      expect((await goals.findById(annual.id))?.directionId).toBe(vision.id);
      await goals.update(annual.id, { ...draft, title: "新标题" });
      expect(await goals.findById(annual.id)).toMatchObject({ horizon: "annual", directionId: vision.id });
      await expect(goals.update(annual.id, { ...draft, directionId: null })).rejects.toThrow("长期方向");
      await life.setArchived(vision.id, true);
      await goals.update(annual.id, { ...draft, title: "保留已归档方向" });
      await expect(goals.create({ ...draft, horizon: "annual", directionId: vision.id })).rejects.toThrow("归档");
      await goals.update(annual.id, { ...draft, horizon: "month", directionId: null });
      expect(await goals.findById(annual.id)).toMatchObject({ horizon: "month", directionId: null });
      const versions = await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("goal", annual.id);
      expect(versions[0].snapshot).toMatchObject({ horizon: "annual", direction_id: vision.id });
      const unclassified = await goals.create(draft);
      expect(unclassified.horizon).toBeNull();
      await expect(goals.update(unclassified.id, { ...draft, horizon: "annual" })).rejects.toThrow();
    } finally { db?.close(); }
  });
  it("migrates V32 without rewriting old facts and validates V33 and legacy backups", async () => {
    const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations.slice(0, 32), clock).run();
      db.exec("INSERT INTO goals (id,title,status,sort_order,created_at,updated_at) VALUES ('old','旧目标','active',0,'2026-10-10','2026-10-10')");
      const before = db.prepare("SELECT * FROM goals").get();
      await new MigrationRunner(sql, migrations, clock).run();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM goals").get()).toEqual({ ...before, horizon: null, direction_id: null });
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual([]);
      const navigation = new LifeNavigationService(new SqliteLifeNavigationRepository(sql), clock, { next: () => "vision" });
      await navigation.create("vision", { title: "方向", description: "" });
      db.exec("UPDATE goals SET horizon='annual',direction_id='vision'");
      const backup = { format: "lifeos-backup", schemaVersion: 33, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(backupTables.slice(0, 36).map(table => [table, db.prepare("SELECT * FROM " + table).all()])) };
      expect(inspectBackup(backup).counts.goals).toBe(1);
      for (const changes of [{ horizon: "week" }, { direction_id: "missing" }, { direction_id: 1 }]) {
        const invalid = structuredClone(backup); Object.assign(invalid.data.goals[0], changes);
        expect(() => inspectBackup(invalid)).toThrow();
      }
      const wrongKind = structuredClone(backup); wrongKind.data.life_navigation[0].kind = "principle";
      expect(() => inspectBackup(wrongKind)).toThrow();
      const legacy = structuredClone(backup); legacy.schemaVersion = 32;
      delete legacy.data.goals[0].horizon; delete legacy.data.goals[0].direction_id;
      expect(inspectBackup(legacy).counts.goals).toBe(1);
      expect(() => db.exec("UPDATE goals SET horizon='week'")).toThrow();
      expect(() => db.exec("UPDATE goals SET direction_id='missing'")).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});

