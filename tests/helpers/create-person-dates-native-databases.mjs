import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { v1PersonDatesMigration } from "../../src/db/migrations/0049-v1-person-dates.ts";

const [source, fresh, legacy] = process.argv.slice(2);
if (!source || !fresh || !legacy || process.argv.length !== 5) {
  throw new Error("Expected three isolated SQLite paths.");
}
const helper = fileURLToPath(new URL("create-domain-history-native-databases.mjs", import.meta.url));
const result = spawnSync(process.execPath, [helper, source, fresh, legacy + ".v47"],
  { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || "Could not create version 48 fixtures.");
for (const path of [source, fresh]) {
  const db = new DatabaseSync(path);
  let transaction = false;
  try {
    db.prepare(`INSERT INTO people (id, name, important_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run("person-dates", "人物日期", "2026-10-01",
      "2026-10-22T08:00:00.000Z", "2026-10-22T08:00:00.000Z");
    if (path === fresh) db.prepare("VACUUM INTO ?").run(legacy);
    db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    transaction = true;
    for (const statement of v1PersonDatesMigration.statements) db.exec(statement);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)")
      .run(v1PersonDatesMigration.id, "2026-10-22T08:00:00.000Z");
    db.prepare("INSERT INTO person_dates VALUES (?, ?, ?, ?, ?)")
      .run("person-dates", 0, "birthday", "生日", "1990-02-28");
    db.prepare("INSERT INTO person_dates VALUES (?, ?, ?, ?, ?)")
      .run("person-dates", 1, "important", "  第一次合作  ", path === source ? "2024-02-29" : "2026-10-22");
    db.exec("COMMIT");
    transaction = false;
  } catch (error) {
    if (transaction) db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
