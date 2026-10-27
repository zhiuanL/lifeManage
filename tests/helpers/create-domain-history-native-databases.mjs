import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { v1DomainHistoryMigration } from "../../src/db/migrations/0048-v1-domain-history.ts";

const [source, fresh, legacy] = process.argv.slice(2);
if (!source || !fresh || !legacy || process.argv.length !== 5) {
  throw new Error("Expected three isolated SQLite paths.");
}
const helper = fileURLToPath(new URL("create-domain-template-native-databases.mjs", import.meta.url));
const result = spawnSync(process.execPath, [helper, source, fresh, legacy + ".v46"],
  { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || "Could not create version 47 fixtures.");
const seed = new DatabaseSync(fresh);
try { seed.prepare("VACUUM INTO ?").run(legacy); } finally { seed.close(); }
for (const path of [source, fresh]) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    for (const statement of v1DomainHistoryMigration.statements) db.exec(statement);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)")
      .run(v1DomainHistoryMigration.id, "2026-10-22T08:00:00.000Z");
    let domain = db.prepare("SELECT id FROM life_domains ORDER BY id LIMIT 1").get();
    if (!domain) {
      db.prepare(`INSERT INTO life_domains
        (id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at)
        VALUES ('native-restore-domain', '恢复前领域', '', '', 'fern', 'heart', 0, ?, ?)`)
        .run("2026-10-21T08:00:00.000Z", "2026-10-21T08:00:00.000Z");
      domain = { id: "native-restore-domain" };
    }
    db.prepare(`UPDATE life_domains SET name = ?, current_state = ?, status = ?, updated_at = ?
      WHERE id = ?`).run(path === source ? "健康与体能" : "恢复前领域",
        "  保留原文\n舒适活动  ", "paused", "2026-10-22T08:00:00.000Z", domain.id);
    db.prepare("UPDATE life_domains SET sort_order = sort_order + 1 WHERE id = ?").run(domain.id);
    db.prepare("UPDATE life_domains SET updated_at = ? WHERE id = ?")
      .run("2026-10-22T09:00:00.000Z", domain.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
