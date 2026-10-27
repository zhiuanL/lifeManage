import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrations } from "../../src/db/migrations";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { normalizeActionDetails, parseActionDetails } from "../../src/domain/planning/ActionDetails";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { ActionService } from "../../src/services/planning/ActionService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
const draft = { title: "散步", notes: "", domainId: null, goalId: null, scheduledFor: null };
describe("V1 action feedback and intentions", () => {
  it("normalizes optional fields and distinguishes zero from missing", () => {
    expect(normalizeActionDetails().actualMinutes).toBeNull();
    expect(normalizeActionDetails({ actualMinutes: 0, actualResult: " 实际结果 " })).toMatchObject({ actualMinutes: 0, actualResult: "实际结果" });
    for (const actualMinutes of [-1, 1.5, NaN, Infinity, "3", 1e20]) {
      expect(() => normalizeActionDetails({ actualMinutes })).toThrow("投入时间");
    }
    expect(() => normalizeActionDetails({ trigger: "a".repeat(2001) })).toThrow("触发情境");
    for (const json of ["[]", "null", "oops", "{\"unknown\":1}"]) expect(() => parseActionDetails(json)).toThrow();
  });
  for (const memory of [false, true]) it(`${memory ? "preview" : "SQLite"} preserves feedback across toggles, edits and schedule changes`, async () => {
    const db = memory ? null : new DatabaseSync(":memory:");
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      await new MigrationRunner(sql, migrations, clock).run();
      const repo = new SqliteActionRepository(sql);
      const service = new ActionService(repo, new SqliteGoalRepository(sql), new SqliteLifeDomainRepository(sql), clock, { next: () => "action" });
      const details = normalizeActionDetails({ actualResult: "走了两圈", actualMinutes: 0, learning: "午间更轻松", problems: "下雨", incompleteReason: "天气", nextAdjustment: "室内", trigger: "午饭后", execution: "散步", fallback: "拉伸" });
      const action = await service.create({ ...draft, details });
      expect(await repo.findById(action.id)).toMatchObject({ details, status: "open" });
      await service.toggleCompletion(action.id);
      await service.toggleCompletion(action.id);
      await service.update(action.id, { ...draft, title: "新名称" });
      expect((await repo.findById(action.id))?.details).toEqual(details);
      await service.update(action.id, { ...draft, scheduledFor: "2026-10-14" }, { reason: "personal", note: "改期" });
      expect((await repo.findById(action.id))?.details).toEqual(details);
      const before = await repo.findById(action.id);
      await expect(service.update(action.id, { ...draft, details: { actualMinutes: -1 } })).rejects.toThrow();
      expect(await repo.findById(action.id)).toEqual(before);
      await service.update(action.id, { ...draft, scheduledFor: "2026-10-14", details: {} });
      expect((await repo.findById(action.id))?.details).toEqual(normalizeActionDetails());
    } finally { db?.close(); }
  });
  it("upgrades old rows without changing their histories and validates current backups", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 40), clock).run();
      db.prepare("INSERT INTO actions (id, title, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("old", "旧行动", "open", 0, clock.now().toISOString(), clock.now().toISOString());
      const histories = ["action_plan_changes", "action_state_events", "action_completion_plans"].map(t => db.prepare("SELECT * FROM " + t).all());
      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds)
        .toEqual(migrations.slice(40).map(migration => migration.id));
      expect(["action_plan_changes", "action_state_events", "action_completion_plans"].map(t => db.prepare("SELECT * FROM " + t).all())).toEqual(histories);
      expect((await new SqliteActionRepository(sql).findById("old"))?.details).toEqual(normalizeActionDetails());
      const backup = { format: "lifeos-backup", schemaVersion: 41, appVersion: "0.1.0", exportedAt: clock.now().toISOString(), data: Object.fromEntries(backupTables.map(t => [t, db.prepare("SELECT * FROM " + t).all()])) };
      expect(inspectBackup(backup).counts.actions).toBe(1);
      backup.data.actions[0].details_json = "[]";
      expect(() => inspectBackup(backup)).toThrow("行动反馈");
      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds).toEqual([]);
    } finally { db.close(); }
  });
});
