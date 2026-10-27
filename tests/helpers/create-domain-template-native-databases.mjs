import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { v1DomainTemplatesMigration } from "../../src/db/migrations/0047-v1-domain-templates.ts";

const [source, fresh, legacy] = process.argv.slice(2);
if (!source || !fresh || !legacy || process.argv.length !== 5) {
  throw new Error("Expected three isolated SQLite paths.");
}
const helper = fileURLToPath(new URL("create-inbox-record-native-databases.mjs", import.meta.url));
const result = spawnSync(process.execPath, [helper, source, fresh, legacy + ".v45"],
  { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || "Could not create version 46 fixtures.");
const seed = new DatabaseSync(fresh);
try {
  seed.prepare("VACUUM INTO ?").run(legacy);
} finally { seed.close(); }
for (const path of [source, fresh]) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    db.prepare(`INSERT INTO templates (id, category, name, version, defaults_json, created_at, updated_at)
      VALUES ('preserved-template', 'habit', '原节奏', 3, '{"frequency":"保留原文"}', ?, ?)`)
      .run("2026-10-14T08:00:00.000Z", "2026-10-20T08:00:00.000Z");
    for (const statement of v1DomainTemplatesMigration.statements) db.exec(statement);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)")
      .run(v1DomainTemplatesMigration.id, "2026-10-21T08:00:00.000Z");
    db.prepare(`INSERT INTO templates (id, category, name, version, defaults_json, created_at, updated_at)
      VALUES ('native-domain-template', 'domain', ?, 2, ?, ?, ?)`).run(
        path === source ? "自己的健康领域" : "恢复前模板",
        JSON.stringify({ name: "体能", description: "", focus: "轻松活动",
          longTermExpectation: "舒适地生活", color: "fern", icon: "heart" }),
        "2026-10-20T08:00:00.000Z", "2026-10-21T08:00:00.000Z");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
