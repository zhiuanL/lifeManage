import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { v1LandscapeContextMigration } from "../../src/db/migrations/0052-v1-landscape-context.ts";

const [source, fresh, legacy] = process.argv.slice(2);
if (!source || !fresh || !legacy || process.argv.length !== 5) {
  throw new Error("Expected three isolated SQLite paths.");
}
const helper = fileURLToPath(new URL("create-domain-satisfaction-native-databases.mjs", import.meta.url));
const result = spawnSync(process.execPath, [helper, source, fresh, legacy + ".v50"],
  { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || "Could not create version 51 fixtures.");
const stamp = "2026-10-22T08:00:00.000Z";
for (const path of [source, fresh]) {
  const db = new DatabaseSync(path);
  let transaction = false;
  try {
    if (path === fresh) db.prepare("VACUUM INTO ?").run(legacy);
    db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    transaction = true;
    for (const statement of v1LandscapeContextMigration.statements) db.exec(statement);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(v1LandscapeContextMigration.id, stamp);
    db.prepare("INSERT INTO landscape_context VALUES ('current', ?, ?, ?, ?, ?)")
      .run(path === source ? " 原始生活状态 " : "另一个空间",
        "恢复节奏", "少做一些", "工作与休息\n仍有拉扯", stamp);
    db.exec("COMMIT");
    transaction = false;
  } catch (error) {
    if (transaction) db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
