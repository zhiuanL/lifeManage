import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { v1ReviewStructureMigration } from "../../src/db/migrations/0043-v1-review-structure.ts";

const [source, fresh] = process.argv.slice(2);
if (!source || !fresh || process.argv.length !== 4) throw new Error("Expected two isolated SQLite paths.");
const result = spawnSync(process.execPath, [fileURLToPath(new URL("create-m6-backup-databases.mjs", import.meta.url)), source, fresh], { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || "Could not create version 42 fixtures.");
const periods = [
  ["daily", "2026-10-13", "2026-10-13"],
  ["weekly", "2026-10-12", "2026-10-18"],
  ["monthly", "2026-10-01", "2026-10-31"],
  ["quarterly", "2026-10-01", "2026-12-31"],
  ["annual", "2026-01-01", "2026-12-31"],
];
for (const path of [source, fresh]) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    for (const statement of v1ReviewStructureMigration.statements) db.exec(statement);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(v1ReviewStructureMigration.id, "2026-10-13T08:00:00.000Z");
    if (path === source) {
      for (const [type, start, end] of periods) {
        const template = JSON.stringify({ id: `native-${type}`, name: type, version: 2, fields: [{ key: "summary", label: "Summary", defaultValue: "" }, { key: "blank", label: "Blank", defaultValue: "" }] });
        db.prepare(`INSERT INTO reviews (id, title, reflection, insight, next_focus, reviewed_on, created_at, updated_at, review_type, period_start, period_end, review_status, review_mode, template_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(`native-${type}`, type, "Original", "", "", "2026-10-13", "2026-10-13T08:00:00.000Z", "2026-10-13T08:00:00.000Z", type, start, end, "draft", "structured", template);
        db.prepare("INSERT INTO review_answers VALUES (?, ?, ?)").run(`native-${type}`, "summary", `${type} answer`);
        db.prepare("INSERT INTO review_answers VALUES (?, ?, ?)").run(`native-${type}`, "blank", "");
        db.prepare("UPDATE reviews SET reflection = ?, updated_at = ? WHERE id = ?").run("Edited", "2026-10-13T09:00:00.000Z", `native-${type}`);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
