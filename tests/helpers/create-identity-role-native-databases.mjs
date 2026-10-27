import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { v1IdentityRolesMigration } from "../../src/db/migrations/0045-v1-identity-roles.ts";

const [source, fresh] = process.argv.slice(2);
if (!source || !fresh || process.argv.length !== 4) throw new Error("Expected two isolated SQLite paths.");
const result = spawnSync(process.execPath,
  [fileURLToPath(new URL("create-review-links-native-databases.mjs", import.meta.url)), source, fresh],
  { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || "Could not create version 44 fixtures.");
for (const path of [source, fresh]) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    for (const statement of v1IdentityRolesMigration.statements) db.exec(statement);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(v1IdentityRolesMigration.id, "2026-10-14T08:00:00.000Z");
    db.prepare(`INSERT INTO identity_roles (id, name, active, created_at, updated_at, version)
      VALUES ('native-role', ?, 1, '2026-10-14T08:00:00.000Z', '2026-10-14T08:00:00.000Z', 1)`)
      .run(path === source ? "学习者" : "恢复前角色");
    if (path === source) {
      const domain = db.prepare("SELECT id FROM life_domains ORDER BY id LIMIT 1").get();
      db.prepare("INSERT INTO identity_role_domain_links VALUES (?, ?)").run("native-role", domain.id);
      db.prepare("INSERT INTO identity_role_goal_links VALUES (?, ?)").run("native-role", "goal-1");
      db.prepare("UPDATE identity_roles SET active = 0, version = 2 WHERE id = 'native-role'").run();
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
