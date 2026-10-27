import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { v1DomainSatisfactionMigration } from "../../src/db/migrations/0051-v1-domain-satisfaction.ts";

const [source, fresh, legacy] = process.argv.slice(2);
if (!source || !fresh || !legacy || process.argv.length !== 5) {
  throw new Error("Expected three isolated SQLite paths.");
}
const helper = fileURLToPath(new URL("create-person-relationship-native-databases.mjs", import.meta.url));
const result = spawnSync(process.execPath, [helper, source, fresh, legacy + ".v49"],
  { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || "Could not create version 50 fixtures.");
const stamp = "2026-10-22T08:00:00.000Z";
for (const path of [source, fresh]) {
  const db = new DatabaseSync(path);
  let transaction = false;
  try {
    if (path === fresh) db.prepare("VACUUM INTO ?").run(legacy);
    db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    transaction = true;
    for (const statement of v1DomainSatisfactionMigration.statements) db.exec(statement);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(v1DomainSatisfactionMigration.id, stamp);
    db.prepare(`INSERT INTO life_domains
      (id, name, color_key, icon_key, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run("satisfaction-domain", "评分领域", "fern", "heart", 99, stamp, stamp);
    const metric = path === source ? "source-rating" : "fresh-rating";
    db.prepare(`INSERT INTO metric_definitions (id, name, unit, archived, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(metric, "明确评分", "个人量纲", 1, stamp);
    db.prepare("INSERT INTO metric_domain_links VALUES (?, ?)").run(metric, "satisfaction-domain");
    db.prepare(`INSERT INTO metric_records
      (id, metric_id, recorded_on, value, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("satisfaction-record", metric, "2026-10-20", path === source ? 0 : 2, " 原评分记录 ", stamp, stamp);
    db.prepare("INSERT INTO domain_satisfaction_links VALUES (?, ?)").run("satisfaction-domain", metric);
    db.exec("COMMIT");
    transaction = false;
  } catch (error) {
    if (transaction) db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
