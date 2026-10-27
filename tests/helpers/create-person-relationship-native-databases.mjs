import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { v1PersonRelationshipHistoryMigration } from "../../src/db/migrations/0050-v1-person-relationship-history.ts";

const [source, fresh, legacy] = process.argv.slice(2);
if (!source || !fresh || !legacy || process.argv.length !== 5) {
  throw new Error("Expected three isolated SQLite paths.");
}
const helper = fileURLToPath(new URL("create-person-dates-native-databases.mjs", import.meta.url));
const result = spawnSync(process.execPath, [helper, source, fresh, legacy + ".v48"],
  { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || "Could not create version 49 fixtures.");
for (const path of [source, fresh]) {
  const db = new DatabaseSync(path);
  let transaction = false;
  try {
    if (path === fresh) db.prepare("VACUUM INTO ?").run(legacy);
    db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    transaction = true;
    for (const statement of v1PersonRelationshipHistoryMigration.statements) db.exec(statement);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)")
      .run(v1PersonRelationshipHistoryMigration.id, "2026-10-22T08:00:00.000Z");
    const before = { name: "  原始人物名称  ", relationshipType: "朋友", state: "保持联系", domainIds: [] };
    const after = { name: "人物日期", relationshipType: "朋友",
      state: path === source ? "暂时疏远" : "继续联系", domainIds: [] };
    db.prepare(`INSERT INTO person_relationship_versions
      (id, person_id, changed_at, before_json, after_json) VALUES (?, ?, ?, ?, ?)`)
      .run(7, "person-dates", "2026-10-22T08:00:00.000Z", JSON.stringify(before), JSON.stringify(after));
    db.prepare("UPDATE people SET state = ? WHERE id = ?").run(after.state, "person-dates");
    db.exec("COMMIT");
    transaction = false;
  } catch (error) {
    if (transaction) db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
