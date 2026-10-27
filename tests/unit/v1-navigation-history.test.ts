import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeNavigationRepository } from "../../src/repositories/sqlite/SqliteLifeNavigationRepository";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { LifeNavigationService } from "../../src/services/life/LifeNavigationService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
describe("V1 navigation history", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " captures edits and archive transitions but not no-ops or failed writes", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      db?.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations, clock).run();
      let sequence = 0;
      const repository = new SqliteLifeNavigationRepository(sql);
      const service = new LifeNavigationService(repository, clock, { next: () => "nav-" + ++sequence });
      const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
      for (const kind of ["mission", "value", "vision", "principle"] as const) {
        const record = await service.create(kind, { title: "初始标题", description: "最初内容" });
        expect(await history.list("navigation", record.id)).toEqual([]);
        await service.update(record.id, { title: " 初始标题 ", description: "最初内容" });
        await service.setArchived(record.id, false);
        expect(await history.list("navigation", record.id)).toEqual([]);
        await service.update(record.id, { title: "新标题", description: "后来内容" });
        expect((await history.list("navigation", record.id))[0].snapshot).toMatchObject({
          kind, title: "初始标题", description: "最初内容", archived_at: null,
        });
        await service.setArchived(record.id, true);
        await service.setArchived(record.id, true);
        await expect(service.update(record.id, { title: "失败", description: "" })).rejects.toThrow();
        await expect(repository.update(record.id, { title: "失败", description: "" }, clock.now().toISOString())).rejects.toThrow();
        expect(await history.list("navigation", record.id)).toHaveLength(2);
        await service.setArchived(record.id, false);
        const versions = await history.list("navigation", record.id);
        expect(versions).toHaveLength(3);
        await expect(sql.executeTransaction([
          { statement: "UPDATE life_navigation SET title = ?, description = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
            bindValues: ["回滚标题", "回滚内容", clock.now().toISOString(), record.id] },
          { statement: "UPDATE life_navigation SET title = ?, description = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
            bindValues: ["不会保存", "", clock.now().toISOString(), "missing"], requireAffectedRows: true },
        ])).resolves.toBeNull();
        expect(await history.list("navigation", record.id)).toEqual(versions);
        expect((await service.findById(record.id))?.description).toBe("后来内容");
        expect(versions[0].snapshot.archived_at).toBe(clock.now().toISOString());
        expect(versions[1].snapshot.title).toBe("新标题");
        expect(versions[0].id).toBeGreaterThan(versions[1].id);
        expect((await service.findById(record.id))?.archivedAt).toBeNull();
      }
      await expect(service.update("missing", { title: "失败", description: "" })).rejects.toThrow();
      expect(await history.list("navigation", "missing")).toEqual([]);
    } finally { db?.close(); }
  });
  it("preserves the sequence when all old history was deleted", async () => {
    const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
    try {
      await new MigrationRunner(sql, migrations.slice(0, 33), clock).run();
      db.exec("INSERT INTO object_versions VALUES (90,'goal','deleted','2026-10-10','{}'); DELETE FROM object_versions");
      await new MigrationRunner(sql, migrations, clock).run();
      const service = new LifeNavigationService(new SqliteLifeNavigationRepository(sql), clock, { next: () => "new" });
      await service.create("mission", { title: "使命", description: "" });
      await service.update("new", { title: "新使命", description: "" });
      expect((await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("navigation", "new"))[0].id).toBe(91);
    } finally { db.close(); }
  });
  it("preserves V33 history, sequence, other triggers and accepts both backup versions", async () => {
    const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations.slice(0, 33), clock).run();
      const previousTriggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
      db.exec(`INSERT INTO object_versions VALUES (42,'goal','old','2026-10-10','{"title":"旧快照"}')`);
      db.exec("INSERT INTO object_versions VALUES (90,'review','removed','2026-10-10','{}'); DELETE FROM object_versions WHERE id=90");
      const before = db.prepare("SELECT * FROM object_versions").all();
      await new MigrationRunner(sql, migrations.slice(0, 34), clock).run();
      await new MigrationRunner(sql, migrations.slice(0, 34), clock).run();
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(before);
      expect(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name != 'life_navigation_versions_before_update' ORDER BY name").all()).toEqual(previousTriggers);
      const service = new LifeNavigationService(new SqliteLifeNavigationRepository(sql), clock, { next: () => "vision" });
      await service.create("vision", { title: "方向", description: "初始内容" });
      await service.update("vision", { title: "方向", description: "新内容" });
      expect((await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("navigation", "vision"))[0].id).toBe(91);
      db.exec("INSERT INTO goals (id,title,status,sort_order,created_at,updated_at) VALUES ('goal','旧目标','active',0,'2026-10-10','2026-10-10'); UPDATE goals SET title='新目标'");
      expect(await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("goal", "goal")).toHaveLength(1);
      const backup = { format: "lifeos-backup", schemaVersion: 34, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(backupTables.slice(0, 36).map(table => [table, db.prepare("SELECT * FROM " + table).all()])) };
      expect(inspectBackup(backup).counts.object_versions).toBe(3);
      const navigationIndex = backup.data.object_versions.findIndex(row => row.object_type === "navigation");
      for (const [key, value] of [["kind", "invalid"], ["title", " "], ["description", "x".repeat(6001)],
        ["created_at", "invalid"], ["updated_at", null], ["archived_at", 7]]) {
        const invalid = structuredClone(backup);
        const snapshot = JSON.parse(String(invalid.data.object_versions[navigationIndex].snapshot_json));
        snapshot[String(key)] = value;
        invalid.data.object_versions[navigationIndex].snapshot_json = JSON.stringify(snapshot);
        expect(() => inspectBackup(invalid)).toThrow();
      }
      for (const snapshot of ["{", "[]", "null"]) {
        const invalid = structuredClone(backup);
        invalid.data.object_versions[navigationIndex].snapshot_json = snapshot;
        expect(() => inspectBackup(invalid)).toThrow();
      }
      const invalidVersion = structuredClone(backup); invalidVersion.schemaVersion = 33;
      expect(() => inspectBackup(invalidVersion)).toThrow();
      const legacy = structuredClone(backup); legacy.schemaVersion = 33;
      legacy.data.object_versions = legacy.data.object_versions.filter(row => row.object_type !== "navigation");
      expect(inspectBackup(legacy).counts.object_versions).toBe(2);
      expect(() => db.exec("INSERT INTO object_versions (object_type,object_id,changed_at,snapshot_json) VALUES ('unknown','x','2026-10-12','{}')")).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    } finally { db.close(); }
  });
});
