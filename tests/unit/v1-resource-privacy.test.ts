import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { inspectBackup, backupTables } from "../../src/domain/backup/Backup";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

it("preserves owner privacy and facts during migration, rollback and independent changes", async () => {
  const db = new DatabaseSync(":memory:");
  const sql = nativeSqliteExecutor(db);
  const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
  try {
    db.exec("PRAGMA foreign_keys=ON");
    await new MigrationRunner(sql, migrations.slice(0, 39), clock).run();
    for (const level of ["normal", "private", "highly_sensitive"]) {
      db.prepare("INSERT INTO goals (id,title,status,sort_order,created_at,updated_at,privacy_level) VALUES (?, ?, 'active', 0, '2026-10-12', '2026-10-12', ?)").run(level, level, level);
      db.prepare("INSERT INTO resource_needs (id,goal_id,kind,description,created_at,updated_at) VALUES (?, ?, 'time', 'two hours', '2026-10-12', '2026-10-12')").run(level, level);
    }
    const facts = db.prepare("SELECT * FROM resource_needs ORDER BY id").all();
    const last = migrations[39];
    await expect(new MigrationRunner(sql, [...migrations.slice(0, 39), { ...last, statements: [...last.statements, "SELECT missing FROM resource_needs"] }], clock).run()).rejects.toThrow();
    expect(db.prepare("SELECT * FROM resource_needs ORDER BY id").all()).toEqual(facts);
    await new MigrationRunner(sql, migrations, clock).run();
    await new MigrationRunner(sql, migrations, clock).run();
    expect(db.prepare("SELECT * FROM resource_needs ORDER BY id").all()).toEqual(facts.map(row => ({ ...row, privacy_level: row.id })));
    const privacy = new SqlitePrivacyRepository(sql);
    await privacy.set("goal", "highly_sensitive", "normal");
    expect((await privacy.list()).get("resource:highly_sensitive")).toBe("highly_sensitive");
    await privacy.set("resource", "normal", "private");
    expect((await privacy.list()).get("goal:normal")).toBe("normal");
    const backup = { format: "lifeos-backup", schemaVersion: 40, appVersion: "0.1.0", exportedAt: clock.now().toISOString(), data: Object.fromEntries(backupTables.map(table => [table, db.prepare("SELECT * FROM " + table).all()])) };
    expect(inspectBackup(backup).counts.resource_needs).toBe(3);
    for (const level of [null, "invalid"]) {
      const bad = structuredClone(backup);
      bad.data.resource_needs[0].privacy_level = level;
      expect(() => inspectBackup(bad)).toThrow();
    }
    expect(() => db.exec("UPDATE resource_needs SET privacy_level='invalid'")).toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { db.close(); }
});
