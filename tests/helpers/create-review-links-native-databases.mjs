import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

const [source, fresh] = process.argv.slice(2);
if (!source || !fresh || process.argv.length !== 4) throw new Error("Expected two isolated SQLite paths.");
const result = spawnSync(process.execPath, [fileURLToPath(new URL("create-review-native-databases.mjs", import.meta.url)), source, fresh], { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || "Could not create version 43 fixtures.");
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "./0043-v1-review-structure" ? `${specifier}.ts` : specifier, context);
  },
});
const { v1ReviewObjectLinksMigration } = await import("../../src/db/migrations/0044-v1-review-object-links.ts");
hook.deregister();
for (const path of [source, fresh]) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    for (const statement of v1ReviewObjectLinksMigration.statements) db.exec(statement);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(v1ReviewObjectLinksMigration.id, "2026-10-13T10:00:00.000Z");
    if (path === source) {
      db.prepare("INSERT INTO review_goal_links VALUES (?, ?)").run("native-weekly", "goal-1");
      db.prepare("INSERT INTO review_issue_links VALUES (?, ?)").run("native-weekly", "issue-1");
      db.prepare("UPDATE reviews SET reflection = ? WHERE id = ?").run("Linked review", "native-weekly");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
