import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { identityRoleBackupTables, identityRoleTables, inspectBackup, supportedBackupTables } from "../../src/domain/backup/Backup";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-10-14T08:00:00Z") };
async function fixture() {
  const db = new DatabaseSync(":memory:");
  try {
    await new MigrationRunner(nativeSqliteExecutor(db), migrations, clock).run();
    db.prepare(`INSERT INTO identity_roles (id, name, active, created_at, updated_at, version)
      VALUES ('role-1', '学习者', 1, ?, ?, 1)`).run(clock.now().toISOString(), clock.now().toISOString());
    db.prepare("UPDATE identity_roles SET active = 0, version = 2 WHERE id = 'role-1'").run();
    return { format: "lifeos-backup", schemaVersion: 45, appVersion: "0.1.0",
      exportedAt: clock.now().toISOString(),
      data: Object.fromEntries(identityRoleBackupTables.map(table => [table, db.prepare("SELECT * FROM " + table).all()])) };
  } finally { db.close(); }
}

describe("identity role backup preflight", () => {
  it("counts Chinese roles and history while retaining version 44 compatibility", async () => {
    const backup = await fixture();
    const report = inspectBackup(JSON.parse(JSON.stringify(backup)));
    expect(report.counts.identity_roles).toBe(1);
    expect(report.counts.identity_role_versions).toBe(1);
    const old = { ...backup, schemaVersion: 44,
      data: Object.fromEntries(supportedBackupTables.map(table => [table, backup.data[table]])) };
    const previous = inspectBackup(old);
    expect(previous.counts.identity_roles).toBe(0);
    expect(previous.total).toBe(report.total - 2);
    for (const table of identityRoleTables) expect(previous.counts[table]).toBe(0);
  });
  it("rejects orphan role links and damaged history before restoring", async () => {
    const backup = await fixture();
    const orphan = structuredClone(backup);
    orphan.data.identity_role_goal_links = [{ role_id: "role-1", goal_id: "missing" }];
    expect(() => inspectBackup(orphan)).toThrow("身份角色关联");
    const damaged = structuredClone(backup);
    damaged.data.identity_role_versions[0].snapshot_json = "{}";
    expect(() => inspectBackup(damaged)).toThrow("身份角色备份字段");
    expect(inspectBackup(backup).counts.identity_roles).toBe(1);
  });
});
