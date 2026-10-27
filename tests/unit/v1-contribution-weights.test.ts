import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { calculateGoalProgress } from "../../src/domain/progress/GoalProgress";
import { normalizeProgressWeight } from "../../src/domain/progress/ProgressWeight";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { GoalService } from "../../src/services/planning/GoalService";
import { ActionService } from "../../src/services/planning/ActionService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const draft = { title: "目标", description: "", domainId: null, status: "active" as const, targetDate: null };
describe("V1 contribution weights", () => {
  it("defaults to equal contributions and rejects invalid values", () => {
    expect(normalizeProgressWeight(undefined)).toBe(1);
    for (const weight of [0, -1, 101, NaN, Infinity]) expect(() => normalizeProgressWeight(weight)).toThrow();
    expect(normalizeProgressWeight(0.01)).toBe(0.01);
    expect(normalizeProgressWeight(100)).toBe(100);
  });
  it("migrates V28 facts unchanged and validates V29 backups", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 28), clock).run();
      db.exec("INSERT INTO goals (id,title,status,sort_order,created_at,updated_at) VALUES ('old','旧目标','active',0,'2026-10-10','2026-10-10')");
      db.exec("INSERT INTO actions (id,title,status,sort_order,created_at,updated_at) VALUES ('act','旧行动','open',0,'2026-10-10','2026-10-10')");
      const tables = ["goals", "actions", "object_versions", "action_plan_changes", "action_state_events", "action_completion_plans"];
      const before = tables.map((table) => db.prepare("SELECT * FROM " + table).all());
      await new MigrationRunner(sql, migrations, clock).run();
      for (const [index, table] of tables.entries()) {
        expect(db.prepare("SELECT * FROM " + table).all()).toEqual(index < 2 ? before[index].map((row) => ({ ...row, progress_weight: 1, ...(index === 0 ? { priority: "medium", horizon: null, direction_id: null } : { details_json: "{}" }) })) : before[index]);
      }
      const backup = { format: "lifeos-backup", schemaVersion: 29, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(backupTables.slice(0, 34).map((table) => [table, db.prepare("SELECT * FROM " + table).all()])) };
      expect(inspectBackup(backup).counts.goals).toBe(1);
      for (const table of ["goals", "actions"]) {
        for (const value of [0, -1, 101, null, "1"]) {
          const invalid = structuredClone(backup);
          invalid.data[table][0].progress_weight = value;
          expect(() => inspectBackup(invalid)).toThrow();
        }
        expect(() => db.prepare("UPDATE " + table + " SET progress_weight = 0").run()).toThrow();
      }
      const legacy = structuredClone(backup);
      legacy.schemaVersion = 28;
      for (const table of ["goals", "actions"]) delete legacy.data[table][0].progress_weight;
      expect(inspectBackup(legacy).counts.actions).toBe(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });

  for (const mode of ["SQLite", "preview"] as const) {
    it(mode + " persists weights without inventing facts", async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      db?.exec("PRAGMA foreign_keys = ON");
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let sequence = 0;
        const ids = { next: () => "weight-" + ++sequence };
        const domains = new SqliteLifeDomainRepository(sql);
        const goalRepo = new SqliteGoalRepository(sql);
        const goals = new GoalService(goalRepo, domains, clock, ids);
        const actions = new ActionService(new SqliteActionRepository(sql), goalRepo, domains, clock, ids);
        const root = await goals.create(draft);
        const child = await goals.create({ ...draft, parentId: root.id, progressWeight: 3, status: "completed" });
        const ad = { title: "行动", notes: "", domainId: null, goalId: root.id, scheduledFor: null };
        const action = await actions.create(ad);
        expect(action.progressWeight).toBe(1);
        expect(calculateGoalProgress(await goals.list(), await actions.list()).get(root.id)?.percent).toBe(75);
        const facts = [await actions.listPlanChanges(), await actions.listStateEvents(), await actions.listCompletionPlans()];
        await actions.update(action.id, { ...ad, progressWeight: 3 });
        await actions.update(action.id, { ...ad, title: "仅标题" });
        expect((await actions.findById(action.id))?.progressWeight).toBe(3);
        expect([await actions.listPlanChanges(), await actions.listStateEvents(), await actions.listCompletionPlans()]).toEqual(facts);
        expect(calculateGoalProgress(await goals.list(), await actions.list()).get(root.id)?.percent).toBe(50);
        await goals.update(child.id, { ...draft, parentId: root.id, progressWeight: 9, status: "completed" });
        expect((await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("goal", child.id))[0].snapshot.progress_weight).toBe(3);
        await goals.update(child.id, { ...draft, parentId: root.id, status: "completed" });
        expect((await goals.findById(child.id))?.progressWeight).toBe(9);
        await goals.create({ ...draft, parentId: root.id });
        expect(calculateGoalProgress(await goals.list(), await actions.list()).get(root.id)?.percent).toBeNull();
        await expect(actions.update(action.id, { ...ad, progressWeight: 0 })).rejects.toThrow();
        expect((await actions.findById(action.id))?.progressWeight).toBe(3);
      } finally { db?.close(); }
    });
  }
});
