import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { migrations } from "../../src/db/migrations";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { navigationKinds } from "../../src/domain/life/LifeNavigation";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeNavigationRepository } from "../../src/repositories/sqlite/SqliteLifeNavigationRepository";
import { LifeNavigationService } from "../../src/services/life/LifeNavigationService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const draft = { title: " 长期方向 ", description: " 保持成长 " };
describe("V1 life navigation", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " supports four kinds, edit, archive and restore without compulsory records", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      await new MigrationRunner(sql, migrations, clock).run();
      let sequence = 0;
      const repo = new SqliteLifeNavigationRepository(sql);
      const service = new LifeNavigationService(repo, clock, { next: () => "nav-" + ++sequence });
      expect(await service.list()).toEqual([]);
      for (const kind of navigationKinds) await service.create(kind, draft);
      expect((await service.list()).map(record => record.kind)).toEqual(navigationKinds);
      expect((await service.list())[0].title).toBe("长期方向");
      const updated = await service.update("nav-1", { title: "新的方向", description: "" });
      expect(await repo.findById("nav-1")).toEqual(updated);
      const archived = await service.setArchived("nav-1", true);
      expect(archived.archivedAt).toBe(clock.now().toISOString());
      await expect(service.update("nav-1", draft)).rejects.toThrow("归档");
      await expect(repo.update("nav-1", draft, clock.now().toISOString())).rejects.toThrow();
      expect(await repo.findById("nav-1")).toEqual(archived);
      expect((await service.setArchived("nav-1", false)).archivedAt).toBeNull();
      await expect(service.update("missing", draft)).rejects.toThrow();
      await expect(service.setArchived("missing", true)).rejects.toThrow();
      for (const invalid of [{ title: " ", description: "" }, { title: "x".repeat(121), description: "" }, { title: "x", description: "x".repeat(6001) }])
        await expect(service.create("vision", invalid)).rejects.toThrow();
      await expect(service.create("unknown" as never, draft)).rejects.toThrow();
      const before = await service.list();
      vi.spyOn(repo, "update").mockRejectedValueOnce(new Error("write failed"));
      await expect(service.update("nav-1", draft)).rejects.toThrow("write failed");
      expect(await service.list()).toEqual(before);
    } finally { db?.close(); }
  });
  it("migrates V31 without rewriting facts and validates V32 and legacy backups", async () => {
    const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
    try {
      await new MigrationRunner(sql, migrations.slice(0, 31), clock).run();
      const before = db.prepare("SELECT * FROM schema_migrations").all();
      await new MigrationRunner(sql, migrations.slice(0, 32), clock).run();
      expect(db.prepare("SELECT * FROM schema_migrations").all().slice(0, -1)).toEqual(before);
      const service = new LifeNavigationService(new SqliteLifeNavigationRepository(sql), clock, { next: () => "vision-1" });
      await service.create("vision", draft);
      const backup = { format: "lifeos-backup", schemaVersion: 32, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(backupTables.slice(0, 36).map(table => [table, db.prepare("SELECT * FROM " + table).all()])) };
      expect(inspectBackup(backup).counts.life_navigation).toBe(1);
      for (const changes of [{ kind: "invalid" }, { title: " " }, { description: "x".repeat(6001) }, { created_at: "invalid" }, { archived_at: 1 }]) {
        const invalid = structuredClone(backup); Object.assign(invalid.data.life_navigation[0], changes);
        expect(() => inspectBackup(invalid)).toThrow();
      }
      const legacy = structuredClone(backup); legacy.schemaVersion = 31; delete legacy.data.life_navigation;
      expect(inspectBackup(legacy).counts.life_navigation).toBe(0);
      for (const statement of ["INSERT INTO life_navigation VALUES ('bad','invalid','x','',NULL,'2026-10-12','2026-10-12')", "INSERT INTO life_navigation VALUES ('bad','vision',' ','',NULL,'2026-10-12','2026-10-12')"])
        expect(() => db.exec(statement)).toThrow();
    } finally { db.close(); }
  });
});
