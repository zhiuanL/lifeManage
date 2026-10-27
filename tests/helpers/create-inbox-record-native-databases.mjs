import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { v1InboxRecordTargetsMigration } from "../../src/db/migrations/0046-v1-inbox-record-targets.ts";

const [source, fresh, legacy] = process.argv.slice(2);
if (!source || !fresh || !legacy || process.argv.length !== 5) {
  throw new Error("Expected three isolated SQLite paths.");
}
const helper = fileURLToPath(new URL("create-identity-role-native-databases.mjs", import.meta.url));
const result = spawnSync(process.execPath, [helper, source, legacy],
  { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || "Could not create version 45 fixtures.");
const seed = new DatabaseSync(legacy);
try {
  seed.prepare("VACUUM INTO ?").run(fresh);
} finally { seed.close(); }
for (const path of [source, fresh]) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    for (const statement of v1InboxRecordTargetsMigration.statements) db.exec(statement);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)")
      .run(v1InboxRecordTargetsMigration.id, "2026-10-14T08:00:00.000Z");
    if (path === source) {
      const stamp = "2026-10-14T08:00:00.000Z";
      db.prepare(`INSERT INTO people (id, name, notes, created_at, updated_at)
        VALUES ('inbox-native-person', '小林', '新朋友', ?, ?)`).run(stamp, stamp);
      db.prepare(`INSERT INTO life_events
        (id, title, happened_on, description, person_id, goal_id, created_at, updated_at)
        VALUES ('inbox-native-event', '毕业', '2026-10-14', '原始事件', 'inbox-native-person', 'goal-1', ?, ?)`)
        .run(stamp, stamp);
      const domain = db.prepare("SELECT id FROM life_domains ORDER BY id LIMIT 1").get();
      db.prepare("INSERT INTO person_domain_links VALUES (?, ?)").run("inbox-native-person", domain.id);
      db.prepare("INSERT INTO event_domain_links VALUES (?, ?)").run("inbox-native-event", domain.id);
      const insert = db.prepare(`INSERT INTO inbox_items
        (id, content, source, status, target_type, target_id, created_at, updated_at)
        VALUES (?, ?, 'inbox', ?, ?, ?, ?, ?)`);
      insert.run("native-person", "  认识了新朋友\n原文  ", "organized", "person", "inbox-native-person", stamp, stamp);
      insert.run("native-event", "毕业事件", "organized", "event", "inbox-native-event", stamp, stamp);
      insert.run("native-retry", "待重试事件", "processing", "event", "inbox-native-retry", stamp, stamp);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
