import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { v1InboxRecordTargetsMigration } from "../../src/db/migrations/0046-v1-inbox-record-targets";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-10-22T08:00:00Z") };

it("upgrades a V45 SQLite database without losing any inbox privacy and rereads all privacy tables", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    const sql = nativeSqliteExecutor(db);
    await new MigrationRunner(sql, migrations.filter(m => m.id < v1InboxRecordTargetsMigration.id), clock).run();
    for (const level of ["normal", "private", "highly_sensitive"]) {
      db.prepare(`INSERT INTO inbox_items
        (id, content, source, status, created_at, updated_at, privacy_level)
        VALUES (?, ?, 'inbox', 'unprocessed', ?, ?, ?)`)
        .run(level, `  原文 ${level}\n保留  `, clock.now().toISOString(), clock.now().toISOString(), level);
    }
    const before = db.prepare("SELECT * FROM inbox_items ORDER BY id").all();
    await new MigrationRunner(sql, migrations, clock).run();
    expect(db.prepare("SELECT * FROM inbox_items ORDER BY id").all()).toEqual(before);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const privacy = await new SqlitePrivacyRepository(sql).list();
    for (const level of ["normal", "private", "highly_sensitive"]) {
      expect(privacy.get(`inbox:${level}`)).toBe(level);
    }
    expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds).toEqual([]);
  } finally { db.close(); }
});

it("stops before writes when an already-applied V46 has lost privacy, without inventing replacement levels", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const sql = nativeSqliteExecutor(db);
    await new MigrationRunner(sql, migrations.filter(m => m.id <= v1InboxRecordTargetsMigration.id), clock).run();
    db.prepare(`INSERT INTO inbox_items
      (id, content, source, status, created_at, updated_at, privacy_level)
      VALUES ('keep', '  不可猜测旧隐私  ', 'inbox', 'unprocessed', ?, ?, 'highly_sensitive')`)
      .run(clock.now().toISOString(), clock.now().toISOString());
    db.exec("ALTER TABLE inbox_items DROP COLUMN privacy_level");
    const rows = db.prepare("SELECT * FROM inbox_items").all();
    const versions = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
    const write = vi.spyOn(sql, "execute"), transaction = vi.spyOn(sql, "executeTransaction");
    await expect(new MigrationRunner(sql, migrations, clock).run()).rejects.toThrow("不能自动推测原隐私等级");
    expect(write).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(db.prepare("SELECT * FROM inbox_items").all()).toEqual(rows);
    expect(db.prepare("SELECT * FROM schema_migrations ORDER BY version").all()).toEqual(versions);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='person_relationship_versions'").get()).toBeUndefined();
  } finally { db.close(); }
});
