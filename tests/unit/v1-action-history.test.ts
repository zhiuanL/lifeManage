import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { migrations } from "../../src/db/migrations";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { normalizeActionDetails } from "../../src/domain/planning/ActionDetails";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { ActionService } from "../../src/services/planning/ActionService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
const draft = { title: "Action", notes: "", domainId: null, goalId: null, scheduledFor: null };
for (const memory of [false, true]) it("captures feedback changes atomically; preview=" + memory, async () => {
  const db = memory ? null : new DatabaseSync(":memory:");
  const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
  try {
    db?.exec("PRAGMA foreign_keys=ON");
    await new MigrationRunner(sql, migrations, clock).run();
    const repo = new SqliteActionRepository(sql);
    const service = new ActionService(repo, new SqliteGoalRepository(sql), new SqliteLifeDomainRepository(sql), clock, { next: () => "action" });
    const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
    const action = await service.create(draft);
    await service.update(action.id, { ...draft, details: {} });
    expect(await history.list("action", action.id)).toEqual([]);
    const details = normalizeActionDetails({ actualResult: "Result", actualMinutes: 0, trigger: "After lunch" });
    await service.update(action.id, { ...draft, details });
    expect((await history.list("action", action.id))[0].snapshot).toMatchObject({ title: draft.title, status: "open", scheduled_for: null, completed_at: null });
    expect(JSON.parse(String((await history.list("action", action.id))[0].snapshot.details_json))).toEqual(normalizeActionDetails());
    await service.update(action.id, { ...draft, details: { ...details, actualResult: " Result " } });
    await service.toggleCompletion(action.id);
    await service.update(action.id, { ...draft, title: "Renamed", scheduledFor: "2026-10-14" }, { reason: "personal", note: "Reschedule" });
    expect(await history.list("action", action.id)).toHaveLength(1);
    const before = await repo.findById(action.id);
    await expect(service.update(action.id, { ...draft, details: { actualMinutes: -1 } })).rejects.toThrow();
    await expect(repo.update({ ...before!, details: normalizeActionDetails({ actualResult: "Failed" }), domainId: "missing", domainIds: ["missing"] })).rejects.toThrow();
    expect(await repo.findById(action.id)).toEqual(before);
    expect(await history.list("action", action.id)).toHaveLength(1);
    await repo.updatePlan({ ...before!, title: "Changed", status: "open", scheduledFor: "2026-10-15", completedAt: null, details: normalizeActionDetails() }, { reason: "personal", note: "Reschedule" });
    const versions = await history.list("action", action.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].snapshot).toMatchObject({ title: "Renamed", status: "completed", scheduled_for: "2026-10-14", completed_at: clock.now().toISOString() });
    expect(JSON.parse(String(versions[0].snapshot.details_json))).toEqual(details);
    expect(versions[0].id).toBeGreaterThan(versions[1].id);
    expect((await repo.findById(action.id))?.details?.actualMinutes).toBeNull();
    await service.update(action.id, { ...draft, scheduledFor: "2026-10-15", details: {} });
    expect(await history.list("action", action.id)).toHaveLength(2);
  } finally { db?.close(); }
});

it("validates V42 action snapshots and rejects them in V41", async () => {
  const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
  try {
    await new MigrationRunner(sql, migrations, clock).run();
    db.prepare("INSERT INTO actions (id,title,status,sort_order,created_at,updated_at,details_json) VALUES ('a','Action','open',0,'2026-10-13','2026-10-13',?)").run(JSON.stringify({actualMinutes: 0}));
    db.exec("UPDATE actions SET details_json='{}' WHERE id='a'");
    const backup = { format: "lifeos-backup", schemaVersion: 42, appVersion: "0.1.0", exportedAt: clock.now().toISOString(), data: Object.fromEntries(backupTables.map(t => [t, db.prepare("SELECT * FROM " + t).all()])) };
    expect(inspectBackup(backup).counts.object_versions).toBe(1);
    for (const [key, value] of [["title", " "], ["status", "invalid"], ["scheduled_for", "2026-02-30"], ["completed_at", 7], ["updated_at", null], ["details_json", "[]"], ["details_json", JSON.stringify({actualMinutes: -1})], ["details_json", JSON.stringify({unknown: 1})]]) {
      const invalid = structuredClone(backup);
      const snap = JSON.parse(String(invalid.data.object_versions[0].snapshot_json));
      snap[String(key)] = value;
      invalid.data.object_versions[0].snapshot_json = JSON.stringify(snap);
      expect(() => inspectBackup(invalid)).toThrow();
    }
    for (const snapshot of ["null", "[]", "{"]) {
      const invalid = structuredClone(backup); invalid.data.object_versions[0].snapshot_json = snapshot;
      expect(() => inspectBackup(invalid)).toThrow();
    }
    backup.schemaVersion = 41;
    expect(() => inspectBackup(backup)).toThrow();
    backup.data.object_versions = [];
    expect(inspectBackup(backup).counts.actions).toBe(1);
  } finally { db.close(); }
});


for (const empty of [false, true]) it("V41 migration preserves histories, triggers and sequence; empty=" + empty, async () => {
  const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
  try {
    await new MigrationRunner(sql, migrations.slice(0, 41), clock).run();
    db.exec("INSERT INTO object_versions VALUES (42,'goal','old','2026-10-10','{}'); INSERT INTO object_versions VALUES (90,'goal','removed','2026-10-10','{}'); DELETE FROM object_versions WHERE id=90");
    if (empty) db.exec("DELETE FROM object_versions");
    const rows = db.prepare("SELECT * FROM object_versions").all();
    const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
    await new MigrationRunner(sql, migrations.slice(0, 42), clock).run();
    expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(rows);
    expect(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name!='actions_versions_before_update' ORDER BY name").all()).toEqual(triggers);
    db.exec("INSERT INTO actions (id,title,status,sort_order,created_at,updated_at) VALUES ('a','Action','open',0,'2026-10-13','2026-10-13')");
    db.prepare("UPDATE actions SET details_json=? WHERE id='a'").run(JSON.stringify({actualMinutes: 0}));
    expect((await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("action", "a"))[0].id).toBe(91);
    expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
  } finally { db.close(); }
});
